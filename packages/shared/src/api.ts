// Request schemas (validated on the server with Zod) and response DTOs shared with the frontends.
import { z } from "zod";

export const ORDER_STATUSES = ["PENDING", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_SOURCES = ["BOT", "MINIAPP", "WEB", "GROUP"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
export type Role = "CLIENT" | "DRIVER" | "ADMIN";
export type Language = "UZ_LATN" | "UZ_CYRL";

export const MAX_PASSENGERS = 8;

const trimmed = (max: number) => z.string().trim().max(max);

export const CreateOrderInput = z
  .object({
    routeId: z.string().regex(/^[a-f0-9]{24}$/),
    pickup: trimmed(200).min(2),
    dropoff: trimmed(200).min(2),
    /** Parcel ("pochta") order: no passengers. */
    isParcel: z.boolean().default(false),
    passengers: z.number().int().min(1).max(MAX_PASSENGERS).optional(),
    isNow: z.boolean(),
    departureAt: z.iso.datetime().optional(),
    comment: trimmed(500).optional(),
    contactName: trimmed(100).min(1),
    // Defaults to the user's registered phone when omitted.
    contactPhone: trimmed(32).optional(),
    idempotencyKey: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  })
  .refine((v) => v.isNow || Boolean(v.departureAt), { message: "departureAt required", path: ["departureAt"] })
  .refine((v) => v.isParcel || v.passengers !== undefined, { message: "passengers required", path: ["passengers"] });
export type CreateOrderInput = z.infer<typeof CreateOrderInput>;

export const DriverStatusInput = z.object({ status: z.enum(["IN_PROGRESS", "COMPLETED"]) });
export const AdminStatusInput = z.object({ status: z.enum(ORDER_STATUSES), reason: trimmed(300).optional() });
export const CancelInput = z.object({ reason: trimmed(300).optional() });

export const AddDriverInput = z.object({
  telegramId: z.string().regex(/^\d{3,20}$/),
  carModel: trimmed(60).optional(),
  carNumber: trimmed(20).optional(),
  carColor: trimmed(30).optional(),
});
export const UpdateDriverInput = z.object({
  carModel: trimmed(60).optional(),
  carNumber: trimmed(20).optional(),
  carColor: trimmed(30).optional(),
  isActive: z.boolean().optional(),
});

export const ApplyVoucherInput = z.object({ orderId: z.string().regex(/^[a-f0-9]{24}$/) });
export const AdjustPointsInput = z.object({
  userId: z.string().regex(/^[a-f0-9]{24}$/),
  amount: z.number().int().min(-100000).max(100000).refine((n) => n !== 0),
  note: trimmed(200).min(2),
});
export const FavoriteInput = z.object({
  routeId: z.string().regex(/^[a-f0-9]{24}$/),
  pickup: trimmed(200).default(""),
  dropoff: trimmed(200).default(""),
  label: trimmed(50).optional(),
});
export const LanguageInput = z.object({ language: z.enum(["UZ_LATN", "UZ_CYRL"]) });
export const TelegramIdInput = z.object({ telegramId: z.string().regex(/^\d{3,20}$/) });

// ───────────── DTOs ─────────────

export interface RouteDto {
  id: string;
  code: string;
  fromCity: string;
  toCity: string;
  isActive: boolean;
}

export interface DriverPublicDto {
  name: string;
  carModel: string | null;
  carNumber: string | null;
  carColor: string | null;
}

export interface ContactDto {
  name: string | null;
  phone: string | null;
  username: string | null;
  telegramId: string | null;
  /** Original group message text for group orders. */
  sourceText: string | null;
}

export interface OrderDto {
  id: string;
  number: number;
  route: { id: string; fromCity: string; toCity: string };
  pickup: string | null;
  dropoff: string | null;
  passengers: number;
  passengersUnknown: boolean;
  /** Parcel ("pochta") order — `passengers` is not meaningful. */
  isParcel: boolean;
  isNow: boolean;
  departureAt: string | null;
  comment: string | null;
  status: OrderStatus;
  source: OrderSource;
  createdAt: string;
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  driver: DriverPublicDto | null;
  /** Only present for the accepting driver and admins. */
  contact: ContactDto | null;
  voucherPercent: number | null;
}

export interface MeDto {
  id: string;
  firstName: string | null;
  username: string | null;
  role: Role;
  language: Language;
  hasPhone: boolean;
  phone: string | null;
  isDriver: boolean;
  isAdmin: boolean;
  referralCode: string;
  botUsername: string;
}

export interface VoucherDto {
  id: string;
  percent: number;
  status: "ACTIVE" | "USED";
  createdAt: string;
  usedAt: string | null;
}

export interface LedgerDto {
  id: string;
  amount: number;
  type: string;
  note: string | null;
  createdAt: string;
}

export interface LoyaltyDto {
  balance: number;
  pointsPerVoucher: number;
  voucherPercent: number;
  pointsPerTrip: number;
  referralBonus: number;
  referralLink: string;
  referralsCount: number;
  vouchers: VoucherDto[];
  ledger: LedgerDto[];
}

export interface FavoriteDto {
  id: string;
  route: { id: string; fromCity: string; toCity: string };
  pickup: string;
  dropoff: string;
  label: string | null;
}

export interface VoucherLookupDto {
  client: { id: string; name: string | null; username: string | null; phoneMasked: string };
  vouchers: VoucherDto[];
  eligibleOrders: { id: string; number: number; status: OrderStatus; createdAt: string }[];
}

export interface AdminStatsDto {
  today: { orders: number; completed: number; cancelled: number; newClients: number };
  pendingNow: number;
  activeDrivers: number;
  totalClients: number;
  bySource: Record<OrderSource, number>;
  last7Days: { date: string; orders: number; completed: number }[];
}

export interface AdminDriverDto {
  id: string;
  userId: string;
  telegramId: string;
  name: string;
  username: string | null;
  phone: string | null;
  carModel: string | null;
  carNumber: string | null;
  carColor: string | null;
  isActive: boolean;
  botStarted: boolean;
  completedOrders: number;
  activeOrders: number;
  createdAt: string;
}

export interface AdminUserDto {
  id: string;
  telegramId: string;
  name: string;
  username: string | null;
  phone: string | null;
  role: Role;
  language: Language;
  points: number;
  ordersCount: number;
  createdAt: string;
}

export interface GroupMessageDto {
  id: string;
  chatId: string;
  text: string;
  senderUsername: string | null;
  senderName: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  result: string;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
