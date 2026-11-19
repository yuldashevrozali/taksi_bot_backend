import type { Prisma } from "@prisma/client";
import type { ContactView, OrderView } from "@taxi/bot";
import type { ContactDto, OrderDto } from "@taxi/shared";

export const orderInclude = {
  route: true,
  client: true,
  driver: { include: { user: true } },
  groupMessages: true,
  vouchers: true,
} satisfies Prisma.OrderInclude;

export type FullOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function displayName(u: { firstName: string | null; lastName: string | null; username?: string | null }): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || (u.username ? `@${u.username}` : "—");
}

export function orderView(o: FullOrder): OrderView {
  return {
    number: o.number,
    fromCity: o.route.fromCity,
    toCity: o.route.toCity,
    pickup: o.pickup,
    dropoff: o.dropoff,
    passengers: o.passengers,
    passengersUnknown: o.passengersUnknown,
    isParcel: o.parcel === true,
    isNow: o.isNow,
    departureAt: o.departureAt,
    comment: o.comment,
    source: o.source,
  };
}

export function contactView(o: FullOrder): ContactView {
  return {
    name: o.contactName ?? displayName(o.client),
    phone: o.contactPhone ?? o.client.phone,
    username: o.client.username,
    telegramId: o.client.telegramId,
    sourceText: o.groupMessages[0]?.text ?? null,
  };
}

/**
 * Privacy rule: client contact (phone/username/Telegram ID) is included ONLY when `withContact`
 * is true — i.e. for the driver who accepted the order, and for admins.
 */
export function toOrderDto(o: FullOrder, { withContact }: { withContact: boolean }): OrderDto {
  const c = contactView(o);
  const contact: ContactDto | null = withContact
    ? {
        name: c.name,
        phone: c.phone,
        username: c.username,
        telegramId: c.telegramId ? c.telegramId.toString() : null,
        sourceText: c.sourceText,
      }
    : null;
  return {
    id: o.id,
    number: o.number,
    route: { id: o.route.id, fromCity: o.route.fromCity, toCity: o.route.toCity },
    pickup: o.pickup,
    dropoff: o.dropoff,
    passengers: o.passengers,
    passengersUnknown: o.passengersUnknown,
    isParcel: o.parcel === true,
    isNow: o.isNow,
    departureAt: o.departureAt?.toISOString() ?? null,
    comment: o.comment,
    status: o.status,
    source: o.source,
    createdAt: o.createdAt.toISOString(),
    acceptedAt: o.acceptedAt?.toISOString() ?? null,
    startedAt: o.startedAt?.toISOString() ?? null,
    completedAt: o.completedAt?.toISOString() ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    driver: o.driver
      ? {
          name: displayName(o.driver.user),
          carModel: o.driver.carModel,
          carNumber: o.driver.carNumber,
          carColor: o.driver.carColor,
        }
      : null,
    contact,
    voucherPercent: o.vouchers[0]?.percent ?? null,
  };
}
