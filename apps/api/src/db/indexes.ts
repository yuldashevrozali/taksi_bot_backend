import type { PrismaClient } from "@prisma/client";

// Single source of truth for MongoDB indexes. Idempotent — safe to run on every deploy.
// Field names are DB names (snake_case). Index names for @unique fields follow Prisma's convention.
export interface IndexSpec {
  collection: string;
  name: string;
  key: Record<string, 1 | -1>;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
  expireAfterSeconds?: number;
}

const isObjectId = { $type: "objectId" };

export const INDEXES: IndexSpec[] = [
  // users
  { collection: "users", name: "users_telegram_id_key", key: { telegram_id: 1 }, unique: true },
  { collection: "users", name: "users_referral_code_key", key: { referral_code: 1 }, unique: true },
  { collection: "users", name: "users_phone_idx", key: { phone: 1 } },
  { collection: "users", name: "users_username_idx", key: { username: 1 } },
  // drivers
  { collection: "drivers", name: "drivers_user_id_key", key: { user_id: 1 }, unique: true },
  // routes
  { collection: "routes", name: "routes_code_key", key: { code: 1 }, unique: true },
  // orders
  { collection: "orders", name: "orders_number_key", key: { number: 1 }, unique: true },
  { collection: "orders", name: "orders_status_created_at_idx", key: { status: 1, created_at: 1 } },
  { collection: "orders", name: "orders_driver_id_status_idx", key: { driver_id: 1, status: 1 } },
  { collection: "orders", name: "orders_client_id_created_at_idx", key: { client_id: 1, created_at: 1 } },
  {
    collection: "orders",
    name: "uniq_client_idempotency_key",
    key: { client_id: 1, idempotency_key: 1 },
    unique: true,
    partialFilterExpression: { idempotency_key: { $type: "string" } },
  },
  // order_status_history
  { collection: "order_status_history", name: "osh_order_id_created_at_idx", key: { order_id: 1, created_at: 1 } },
  // monitored_groups
  { collection: "monitored_groups", name: "monitored_groups_chat_id_key", key: { chat_id: 1 }, unique: true },
  // group_messages
  {
    collection: "group_messages",
    name: "group_messages_chat_id_message_id_key",
    key: { chat_id: 1, message_id: 1 },
    unique: true,
  },
  { collection: "group_messages", name: "group_messages_result_created_at_idx", key: { result: 1, created_at: 1 } },
  {
    collection: "group_messages",
    name: "group_messages_sender_created_at_idx",
    key: { sender_telegram_id: 1, created_at: 1 },
  },
  {
    collection: "group_messages",
    name: "uniq_order_id",
    key: { order_id: 1 },
    unique: true,
    partialFilterExpression: { order_id: isObjectId },
  },
  // loyalty_ledger
  { collection: "loyalty_ledger", name: "loyalty_ledger_user_id_created_at_idx", key: { user_id: 1, created_at: 1 } },
  {
    collection: "loyalty_ledger",
    name: "uniq_type_user_order",
    key: { type: 1, user_id: 1, order_id: 1 },
    unique: true,
    partialFilterExpression: { order_id: isObjectId },
  },
  {
    collection: "loyalty_ledger",
    name: "uniq_voucher_id",
    key: { voucher_id: 1 },
    unique: true,
    partialFilterExpression: { voucher_id: isObjectId },
  },
  // vouchers
  { collection: "vouchers", name: "vouchers_user_id_status_idx", key: { user_id: 1, status: 1 } },
  {
    collection: "vouchers",
    name: "uniq_order_id",
    key: { order_id: 1 },
    unique: true,
    partialFilterExpression: { order_id: isObjectId },
  },
  // referrals
  { collection: "referrals", name: "referrals_referred_id_key", key: { referred_id: 1 }, unique: true },
  { collection: "referrals", name: "referrals_referrer_id_idx", key: { referrer_id: 1 } },
  { collection: "referrals", name: "referrals_referred_phone_idx", key: { referred_phone: 1 } },
  {
    collection: "referrals",
    name: "uniq_bonus_order_id",
    key: { bonus_order_id: 1 },
    unique: true,
    partialFilterExpression: { bonus_order_id: isObjectId },
  },
  // favorite_routes
  {
    collection: "favorite_routes",
    name: "favorite_routes_user_route_pickup_dropoff_key",
    key: { user_id: 1, route_id: 1, pickup: 1, dropoff: 1 },
    unique: true,
  },
  // settings
  { collection: "settings", name: "settings_key_key", key: { key: 1 }, unique: true },
  // audit_logs
  { collection: "audit_logs", name: "audit_logs_entity_idx", key: { entity_type: 1, entity_id: 1 } },
  { collection: "audit_logs", name: "audit_logs_created_at_idx", key: { created_at: 1 } },
  // login_tokens
  { collection: "login_tokens", name: "login_tokens_token_hash_key", key: { token_hash: 1 }, unique: true },
  // Expired login tokens are removed by MongoDB automatically.
  { collection: "login_tokens", name: "ttl_expires_at", key: { expires_at: 1 }, expireAfterSeconds: 0 },
];

export async function ensureIndexes(db: PrismaClient): Promise<void> {
  const byCollection = new Map<string, IndexSpec[]>();
  for (const spec of INDEXES) {
    byCollection.set(spec.collection, [...(byCollection.get(spec.collection) ?? []), spec]);
  }
  for (const [collection, specs] of byCollection) {
    await db.$runCommandRaw({
      createIndexes: collection,
      indexes: specs.map(({ collection: _c, ...index }) => index),
    } as never);
  }
}
