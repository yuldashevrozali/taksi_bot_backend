import { InlineKeyboard, type Api } from "grammy";
import {
  adminAlertText,
  driverContactText,
  groupAcceptedText,
  groupCancelledText,
  groupOrderText,
  msg,
  takeOrderLink,
  type Logger,
} from "@taxi/bot";
import type { PrismaClient } from "@prisma/client";
import { contactView, displayName, orderView, type FullOrder } from "../orders/order.model.js";

/** All Telegram side effects. Every method is best-effort: it logs and never throws. */
export interface Notifier {
  orderCreated(order: FullOrder): Promise<void>;
  /** Returns false if the driver could not be messaged privately. */
  orderAccepted(order: FullOrder): Promise<boolean>;
  statusChanged(order: FullOrder, pointsEarned: number): Promise<void>;
  orderCancelled(order: FullOrder, by: "client" | "admin"): Promise<void>;
  driverAdded(telegramId: bigint, lang: "UZ_LATN" | "UZ_CYRL"): Promise<void>;
  referralBonus(telegramId: bigint, lang: "UZ_LATN" | "UZ_CYRL", points: number): Promise<void>;
  unacceptedAlert(order: FullOrder, minutes: number): Promise<void>;
}

export const ACCEPT_CALLBACK_PREFIX = "accept:";

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly api: Api,
    private readonly db: PrismaClient,
    private readonly driversChatId: bigint | undefined,
    private readonly log: Logger,
    private readonly links: { botUsername: string; miniAppShortName?: string | undefined },
  ) {}

  private async safe<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      this.log.error({ what, error: e instanceof Error ? e.message : String(e) }, "notify failed");
      return undefined;
    }
  }

  async orderCreated(order: FullOrder): Promise<void> {
    if (order.client.botStarted) {
      await this.safe("confirm order to client", () =>
        this.api.sendMessage(order.client.telegramId.toString(), msg(order.client.language).created(order.number), {
          parse_mode: "HTML",
        }),
      );
    }
    if (!this.driversChatId) {
      this.log.error({ orderId: order.id }, "DRIVERS_GROUP_CHAT_ID not set — order not posted");
      return;
    }
    const chatId = this.driversChatId;
    const sent = await this.safe("post order to drivers group", () =>
      this.api.sendMessage(chatId.toString(), groupOrderText(orderView(order)), {
        parse_mode: "HTML",
        // Opens the Mini App on this order (Web App buttons are not allowed in groups, so a t.me link).
        reply_markup: new InlineKeyboard().url(
          "🚕 Buyurtmani olish",
          takeOrderLink(this.links.botUsername, order.id, this.links.miniAppShortName),
        ),
      }),
    );
    if (sent) {
      await this.db.order.update({
        where: { id: order.id },
        data: { driversChatId: chatId, driversMessageId: sent.message_id },
      });
    }
  }

  private async editGroupMessage(order: FullOrder, text: string): Promise<void> {
    if (!order.driversChatId || !order.driversMessageId) return;
    const chatId = order.driversChatId.toString();
    const messageId = order.driversMessageId;
    await this.safe("edit drivers group message", () =>
      this.api.editMessageText(chatId, messageId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }),
    );
  }

  async orderAccepted(order: FullOrder): Promise<boolean> {
    if (!order.driver) return false;
    const driverUser = order.driver.user;
    await this.editGroupMessage(order, groupAcceptedText(orderView(order), displayName(driverUser)));

    // Group-sourced order: delete the original public message (its copy is already in the DB).
    const source = order.source === "GROUP" ? order.groupMessages[0] : undefined;
    if (source && !source.deletedAt) {
      const deleted = await this.safe("delete source group message", () =>
        this.api.deleteMessage(source.chatId.toString(), source.messageId),
      );
      if (deleted) await this.db.groupMessage.update({ where: { id: source.id }, data: { deletedAt: new Date() } });
    }

    const dm = await this.safe("DM contact to driver", () =>
      this.api.sendMessage(
        driverUser.telegramId.toString(),
        driverContactText(orderView(order), contactView(order), driverUser.language),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
      ),
    );

    if (order.client.botStarted) {
      const car = [order.driver.carColor, order.driver.carModel, order.driver.carNumber].filter(Boolean).join(" ");
      await this.safe("notify client accepted", () =>
        this.api.sendMessage(
          order.client.telegramId.toString(),
          msg(order.client.language).acceptedClient(order.number, displayName(driverUser), car),
          { parse_mode: "HTML" },
        ),
      );
    }
    return Boolean(dm);
  }

  /** Clients only hear "accepted" (sent in orderAccepted). Trip stages are silent; only earned points are announced. */
  async statusChanged(order: FullOrder, pointsEarned: number): Promise<void> {
    if (!order.client.botStarted || order.status !== "COMPLETED" || pointsEarned <= 0) return;
    await this.safe("notify client points", () =>
      this.api.sendMessage(order.client.telegramId.toString(), msg(order.client.language).pointsEarned(pointsEarned)),
    );
  }

  async orderCancelled(order: FullOrder, by: "client" | "admin"): Promise<void> {
    await this.editGroupMessage(order, groupCancelledText(orderView(order)));
    if (order.driver && order.driver.user.botStarted) {
      const driverUser = order.driver.user;
      await this.safe("notify driver cancelled", () =>
        this.api.sendMessage(driverUser.telegramId.toString(), msg(driverUser.language).clientCancelled(order.number)),
      );
    }
    if (by === "admin" && order.client.botStarted) {
      await this.safe("notify client cancelled", () =>
        this.api.sendMessage(order.client.telegramId.toString(), msg(order.client.language).cancelledByAdmin(order.number)),
      );
    }
  }

  async driverAdded(telegramId: bigint, lang: "UZ_LATN" | "UZ_CYRL"): Promise<void> {
    await this.safe("notify driver added", () => this.api.sendMessage(telegramId.toString(), msg(lang).driverAdded));
  }

  async referralBonus(telegramId: bigint, lang: "UZ_LATN" | "UZ_CYRL", points: number): Promise<void> {
    await this.safe("notify referral bonus", () => this.api.sendMessage(telegramId.toString(), msg(lang).referralBonus(points)));
  }

  async unacceptedAlert(order: FullOrder, minutes: number): Promise<void> {
    const admins = await this.db.user.findMany({ where: { role: "ADMIN", botStarted: true } });
    for (const admin of admins) {
      await this.safe("admin alert", () =>
        this.api.sendMessage(admin.telegramId.toString(), adminAlertText(orderView(order), minutes), { parse_mode: "HTML" }),
      );
    }
  }
}

/** For tests: records calls, does nothing. */
export class RecordingNotifier implements Notifier {
  calls: { method: string; orderNumber?: number; args?: unknown[] }[] = [];
  driverDmOk = true;
  async orderCreated(o: FullOrder) {
    this.calls.push({ method: "orderCreated", orderNumber: o.number });
  }
  async orderAccepted(o: FullOrder) {
    this.calls.push({ method: "orderAccepted", orderNumber: o.number });
    return this.driverDmOk;
  }
  async statusChanged(o: FullOrder, points: number) {
    this.calls.push({ method: "statusChanged", orderNumber: o.number, args: [o.status, points] });
  }
  async orderCancelled(o: FullOrder, by: "client" | "admin") {
    this.calls.push({ method: "orderCancelled", orderNumber: o.number, args: [by] });
  }
  async driverAdded(id: bigint) {
    this.calls.push({ method: "driverAdded", args: [id] });
  }
  async referralBonus(id: bigint, _l: string, points: number) {
    this.calls.push({ method: "referralBonus", args: [id, points] });
  }
  async unacceptedAlert(o: FullOrder, minutes: number) {
    this.calls.push({ method: "unacceptedAlert", orderNumber: o.number, args: [minutes] });
  }
}
