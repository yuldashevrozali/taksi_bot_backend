import { GrammyError, InlineKeyboard } from "grammy";
import type { Broadcast, Prisma, PrismaClient, User } from "@prisma/client";
import type { Logger } from "@taxi/bot";
import type { BroadcastAudience, BroadcastDto, BroadcastInput } from "@taxi/shared";
import { DomainError } from "../errors.js";

/** The two Telegram calls a broadcast needs (the grammY Api satisfies this; tests pass a fake). */
export interface BroadcastSender {
  sendMessage(chatId: string, text: string, other?: { reply_markup?: InlineKeyboard; link_preview_options?: { is_disabled: boolean } }): Promise<unknown>;
  sendPhoto(chatId: string, photo: string, other?: { caption?: string; reply_markup?: InlineKeyboard }): Promise<unknown>;
}

const BATCH = 50;

/** Who receives it. Only users who pressed /start can be messaged by a bot. */
async function audienceWhere(db: PrismaClient, audience: BroadcastAudience): Promise<Prisma.UserWhereInput> {
  const base: Prisma.UserWhereInput = { botStarted: true };
  if (audience === "CLIENTS") return { ...base, role: "CLIENT" };
  if (audience === "DRIVERS") {
    const drivers = await db.driver.findMany({ where: { isActive: true }, select: { userId: true } });
    return { ...base, id: { in: drivers.map((d) => d.userId) } };
  }
  return base;
}

export function toBroadcastDto(b: Broadcast & { createdBy?: User | null }): BroadcastDto {
  return {
    id: b.id,
    text: b.text,
    photoUrl: b.photoUrl,
    buttonText: b.buttonText,
    buttonUrl: b.buttonUrl,
    audience: b.audience,
    status: b.status,
    total: b.total,
    sent: b.sent,
    failed: b.failed,
    blocked: b.blocked,
    createdBy: b.createdBy ? [b.createdBy.firstName, b.createdBy.lastName].filter(Boolean).join(" ") || "—" : "—",
    createdAt: b.createdAt.toISOString(),
    finishedAt: b.finishedAt?.toISOString() ?? null,
  };
}

export class BroadcastService {
  private running: Promise<void> | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly sender: BroadcastSender,
    private readonly log: Logger,
    /** Pause between messages. ~20 msg/s keeps us well under Telegram's ~30 msg/s limit. */
    private readonly delayMs = 50,
  ) {}

  countRecipients = async (audience: BroadcastAudience): Promise<number> =>
    this.db.user.count({ where: await audienceWhere(this.db, audience) });

  private async deliver(chatId: string, b: Pick<Broadcast, "text" | "photoUrl" | "buttonText" | "buttonUrl">): Promise<void> {
    const reply_markup = b.buttonText && b.buttonUrl ? new InlineKeyboard().url(b.buttonText, b.buttonUrl) : undefined;
    if (b.photoUrl) {
      await this.sender.sendPhoto(chatId, b.photoUrl, { caption: b.text, ...(reply_markup ? { reply_markup } : {}) });
    } else {
      await this.sender.sendMessage(chatId, b.text, { ...(reply_markup ? { reply_markup } : {}) });
    }
  }

  /** Sends the message only to the admin, to check how it looks. */
  async sendTest(input: BroadcastInput, admin: User): Promise<void> {
    try {
      await this.deliver(admin.telegramId.toString(), {
        text: input.text,
        photoUrl: input.photoUrl ?? null,
        buttonText: input.buttonText ?? null,
        buttonUrl: input.buttonUrl ?? null,
      });
    } catch (e) {
      const description = e instanceof GrammyError ? e.description : e instanceof Error ? e.message : String(e);
      throw Object.assign(new DomainError("telegram_rejected", 400), { details: [{ path: "telegram", message: description }] });
    }
  }

  async create(input: BroadcastInput, admin: User): Promise<Broadcast> {
    const total = await this.countRecipients(input.audience);
    if (total === 0) throw new DomainError("no_recipients", 409);
    const b = await this.db.broadcast.create({
      data: {
        text: input.text,
        photoUrl: input.photoUrl ?? null,
        buttonText: input.buttonText ?? null,
        buttonUrl: input.buttonUrl ?? null,
        audience: input.audience,
        total,
        createdById: admin.id,
      },
    });
    await this.db.auditLog.create({
      data: { actorId: admin.id, action: "broadcast.create", entityType: "broadcast", entityId: b.id, data: { audience: input.audience, total } },
    });
    this.kick();
    return b;
  }

  async cancel(id: string, admin: User): Promise<void> {
    const res = await this.db.broadcast.updateMany({
      where: { id, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });
    if (res.count === 0) throw new DomainError("not_running", 409);
    await this.db.auditLog.create({ data: { actorId: admin.id, action: "broadcast.cancel", entityType: "broadcast", entityId: id } });
  }

  /** Starts the background worker if idle (also used on startup to resume interrupted broadcasts). */
  kick(): void {
    if (this.running) return;
    this.running = this.work()
      .catch((e: unknown) => this.log.error({ error: e instanceof Error ? e.message : String(e) }, "broadcast worker crashed"))
      .finally(() => {
        this.running = null;
      });
  }

  /** Tests: wait until all queued broadcasts are processed. */
  async drain(): Promise<void> {
    while (this.running) await this.running;
  }

  private async work(): Promise<void> {
    for (;;) {
      const next = await this.db.broadcast.findFirst({
        where: { status: { in: ["RUNNING", "QUEUED"] } },
        orderBy: { createdAt: "asc" },
      });
      if (!next) return;
      await this.run(next);
    }
  }

  private async run(b: Broadcast): Promise<void> {
    if (b.status === "QUEUED") {
      await this.db.broadcast.update({ where: { id: b.id }, data: { status: "RUNNING", startedAt: new Date() } });
    }
    this.log.info({ broadcastId: b.id, audience: b.audience, total: b.total }, "broadcast started");
    const where = await audienceWhere(this.db, b.audience);
    let cursor = b.cursorUserId;
    let counters = { sent: b.sent, failed: b.failed, blocked: b.blocked };

    for (;;) {
      // Stop promptly if an admin cancelled it.
      const current = await this.db.broadcast.findUnique({ where: { id: b.id }, select: { status: true } });
      if (current?.status !== "RUNNING") return;

      const users = await this.db.user.findMany({
        where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        take: BATCH,
        select: { id: true, telegramId: true },
      });
      if (users.length === 0) break;

      for (const u of users) {
        const outcome = await this.sendWithRetry(u.telegramId.toString(), b);
        if (outcome === "sent") counters.sent++;
        else if (outcome === "blocked") {
          counters.blocked++;
          // They blocked the bot or deleted the account: skip them next time.
          await this.db.user.update({ where: { id: u.id }, data: { botStarted: false } });
        } else counters.failed++;
        await new Promise((r) => setTimeout(r, this.delayMs));
      }
      cursor = users[users.length - 1]!.id;
      await this.db.broadcast.update({ where: { id: b.id }, data: { ...counters, cursorUserId: cursor } });
    }

    await this.db.broadcast.updateMany({
      where: { id: b.id, status: "RUNNING" },
      data: { status: "DONE", finishedAt: new Date(), ...counters },
    });
    this.log.info({ broadcastId: b.id, ...counters }, "broadcast finished");
  }

  private async sendWithRetry(chatId: string, b: Broadcast): Promise<"sent" | "blocked" | "failed"> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.deliver(chatId, b);
        return "sent";
      } catch (e) {
        if (e instanceof GrammyError) {
          if (e.error_code === 403) return "blocked";
          if (e.error_code === 429) {
            const wait = Number(e.parameters.retry_after ?? 1) * 1000;
            await new Promise((r) => setTimeout(r, wait));
            continue;
          }
          if (e.error_code === 400 && /chat not found|user is deactivated/i.test(e.description)) return "blocked";
        }
        return "failed";
      }
    }
    return "failed";
  }
}
