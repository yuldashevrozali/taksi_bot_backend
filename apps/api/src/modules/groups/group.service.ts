import { randomBytes } from "node:crypto";
import type { GroupMessageResult, Prisma, PrismaClient, User } from "@prisma/client";
import type { Logger } from "@taxi/bot";
import { maskPhone } from "@taxi/shared";
import { isUniqueViolation } from "../errors.js";
import type { OrderService } from "../orders/order.service.js";
import { detectOrder, type Detection } from "./detector.js";

const SOFT_DUPLICATE_WINDOW_MS = 30 * 60_000;

export interface GroupMessageInput {
  chatId: bigint;
  chatTitle?: string | undefined;
  messageId: number;
  text: string;
  from: { id: number; isBot: boolean; firstName: string; lastName?: string | undefined; username?: string | undefined };
}

export interface MembershipChange {
  chatId: bigint;
  title?: string | undefined;
  /** Bot's new status in the chat: administrator | member | left | kicked | restricted */
  status: string;
  canDelete: boolean;
}

export type GroupOutcome =
  | "ignored_drivers_group"
  | "ignored_not_monitored"
  | "ignored"
  | "duplicate_message"
  | "driver_offer"
  | "unrecognized"
  | "duplicate_order"
  | "order_created";

/** Checks the bot's rights in a group the first time we see a message from it. */
export type BotMemberLookup = (chatId: bigint) => Promise<{ status: string; canDelete: boolean } | null>;

export class GroupService {
  constructor(
    private readonly db: PrismaClient,
    private readonly orders: OrderService,
    private readonly driversChatId: bigint | undefined,
    private readonly lookupBotMember: BotMemberLookup,
    private readonly log: Logger,
  ) {}

  /** Bot added/promoted/removed. Groups where the bot is admin are monitored automatically. */
  async membershipChanged(e: MembershipChange): Promise<void> {
    if (this.driversChatId !== undefined && e.chatId === this.driversChatId) return;
    const isAdmin = e.status === "administrator";
    const gone = e.status === "left" || e.status === "kicked";
    const existing = await this.db.monitoredGroup.findUnique({ where: { chatId: e.chatId } });
    if (!existing && !isAdmin) return;
    await this.db.monitoredGroup.upsert({
      where: { chatId: e.chatId },
      create: { chatId: e.chatId, title: e.title ?? null, botIsAdmin: true, canDelete: e.canDelete, isActive: true },
      update: {
        title: e.title ?? existing?.title ?? null,
        botIsAdmin: isAdmin,
        canDelete: isAdmin && e.canDelete,
        ...(gone ? { isActive: false } : {}),
      },
    });
    this.log.info({ chatId: e.chatId.toString(), status: e.status }, "monitored group membership changed");
  }

  private async monitoredGroup(input: GroupMessageInput) {
    let group = await this.db.monitoredGroup.findUnique({ where: { chatId: input.chatId } });
    if (!group) {
      // Bot may have been admin before monitoring existed: check once.
      const member = await this.lookupBotMember(input.chatId).catch(() => null);
      if (member?.status !== "administrator") return null;
      group = await this.db.monitoredGroup.upsert({
        where: { chatId: input.chatId },
        create: { chatId: input.chatId, title: input.chatTitle ?? null, botIsAdmin: true, canDelete: member.canDelete },
        update: {},
      });
    }
    return group.isActive ? group : null;
  }

  async handleMessage(input: GroupMessageInput, now = new Date()): Promise<GroupOutcome> {
    if (this.driversChatId !== undefined && input.chatId === this.driversChatId) return "ignored_drivers_group";
    const group = await this.monitoredGroup(input);
    if (!group) return "ignored_not_monitored";
    await this.db.monitoredGroup.update({ where: { id: group.id }, data: { lastMessageAt: now } });
    if (input.from.isBot) return "ignored";

    let detection: Detection = detectOrder(input.text, now);
    if (detection.kind === "ignore") return "ignored"; // nothing relevant: not stored (privacy)

    // Messages from our own active drivers are offers, not client requests.
    const sender = await this.db.user.findUnique({ where: { telegramId: BigInt(input.from.id) }, include: { driver: true } });
    if (sender?.driver?.isActive && detection.kind === "order") detection = { ...detection, kind: "driver_offer" };

    const result: GroupMessageResult =
      detection.kind === "order" ? "ORDER_CREATED" : detection.kind === "driver_offer" ? "DRIVER_OFFER" : "UNRECOGNIZED";

    // Save the copy FIRST (the original may be deleted later). (chat_id, message_id) is unique.
    let messageRowId: string;
    try {
      const row = await this.db.groupMessage.create({
        data: {
          chatId: input.chatId,
          messageId: input.messageId,
          senderTelegramId: BigInt(input.from.id),
          senderUsername: input.from.username ?? null,
          senderName: [input.from.firstName, input.from.lastName].filter(Boolean).join(" ") || null,
          text: input.text.slice(0, 4000),
          confidence: detection.confidence,
          score: detection.score,
          result,
          signals: detection.signals as Prisma.InputJsonValue,
        },
      });
      messageRowId = row.id;
    } catch (e) {
      if (isUniqueViolation(e)) return "duplicate_message";
      throw e;
    }
    if (detection.kind !== "order") return detection.kind === "driver_offer" ? "driver_offer" : "unrecognized";

    const client = sender ?? (await this.findOrCreateClient(input));
    const route = await this.db.route.findUnique({ where: { code: detection.routeCode! } });
    if (!route || !route.isActive) {
      await this.db.groupMessage.update({ where: { id: messageRowId }, data: { result: "UNRECOGNIZED" } });
      return "unrecognized";
    }

    // Soft duplicate: same person, same route, still open, within 30 min (also catches cross-posting).
    const recent = await this.db.order.findFirst({
      where: {
        clientId: client.id,
        routeId: route.id,
        source: "GROUP",
        status: { in: ["PENDING", "ACCEPTED"] },
        createdAt: { gte: new Date(now.getTime() - SOFT_DUPLICATE_WINDOW_MS) },
      },
    });
    if (recent) {
      await this.db.groupMessage.update({ where: { id: messageRowId }, data: { result: "DUPLICATE" } });
      return "duplicate_order";
    }

    const order = await this.orders.createFromGroup({
      client,
      routeId: route.id,
      groupMessageId: messageRowId,
      detection,
      contactName: [input.from.firstName, input.from.lastName].filter(Boolean).join(" ") || null,
    });
    this.log.info(
      { orderNumber: order.number, chatId: input.chatId.toString(), phone: maskPhone(detection.phone), signals: detection.signals },
      "order created from group message",
    );
    return "order_created";
  }

  private async findOrCreateClient(input: GroupMessageInput): Promise<User> {
    const telegramId = BigInt(input.from.id);
    try {
      return await this.db.user.create({
        data: {
          telegramId,
          firstName: input.from.firstName,
          lastName: input.from.lastName ?? null,
          username: input.from.username ?? null,
          botStarted: false,
          referralCode: randomBytes(6).toString("base64url"),
        },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      return this.db.user.findUniqueOrThrow({ where: { telegramId } });
    }
  }
}
