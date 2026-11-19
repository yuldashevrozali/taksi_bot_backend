import type { ReactNode } from "react";
import { CalendarClock, Car, ClipboardList, History, Home, Inbox, Ticket, User, Users, Zap } from "lucide-react";
import type { OrderDto } from "@taxi/shared";
import { dateTime, haptic, hhmm } from "@taxi/web-core";
import { useApp, minutesSince, type Route } from "./core";
import { clientStatus } from "./i18n";
import { Card, RouteLine, StatusBadge, cx } from "./ui";

export function Page({ title, subtitle, right, children }: { title?: string; subtitle?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-lg px-4 pb-32 pt-4">
      {title && (
        <header className="mb-4 flex items-end justify-between gap-3 animate-rise">
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight">{title}</h1>
            {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
          </div>
          {right}
        </header>
      )}
      {children}
    </div>
  );
}

export function BottomNav() {
  const { route, reset, t, mode } = useApp();
  const items: { route: Route; label: string; icon: ReactNode }[] =
    mode === "driver"
      ? [
          { route: { name: "d-new" }, label: t.tabNew, icon: <Inbox className="size-[22px]" /> },
          { route: { name: "d-mine" }, label: t.tabMine, icon: <Car className="size-[22px]" /> },
          { route: { name: "d-history" }, label: t.tabHistory, icon: <History className="size-[22px]" /> },
          { route: { name: "d-voucher" }, label: t.tabVoucher, icon: <Ticket className="size-[22px]" /> },
        ]
      : [
          { route: { name: "home" }, label: t.tabHome, icon: <Home className="size-[22px]" /> },
          { route: { name: "orders" }, label: t.tabOrders, icon: <ClipboardList className="size-[22px]" /> },
          { route: { name: "profile" }, label: t.tabProfile, icon: <User className="size-[22px]" /> },
        ];
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface/85 pt-2 backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg justify-around">
        {items.map((it) => {
          const active = route.name === it.route.name;
          return (
            <button
              key={it.route.name}
              onClick={() => {
                haptic.select();
                reset(it.route);
              }}
              className={cx("flex min-w-16 flex-col items-center gap-1 px-2 py-1 text-[11px] font-semibold transition-colors", active ? "text-ink" : "text-muted")}
            >
              <span className={cx("grid h-8 w-14 place-items-center rounded-full transition-all", active && "bg-brand text-brand-ink")}>{it.icon}</span>
              {it.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function OrderMeta({ order }: { order: OrderDto }) {
  const { t } = useApp();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
      <span className="inline-flex items-center gap-1.5">
        <Users className="size-4" />
        {t.passengersN(order.passengers, order.passengersUnknown)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        {order.isNow ? <Zap className="size-4 text-brand-strong" /> : <CalendarClock className="size-4" />}
        {order.isNow || !order.departureAt ? t.now : dateTime(order.departureAt)}
      </span>
    </div>
  );
}

/** Compact order card used in lists. */
export function OrderCard({
  order,
  onClick,
  footer,
  showAge,
  clientView,
}: {
  order: OrderDto;
  onClick?: () => void;
  footer?: ReactNode;
  showAge?: boolean;
  /** Clients see only Kutilmoqda / Qabul qilindi / Bekor qilindi. */
  clientView?: boolean;
}) {
  const { t, city } = useApp();
  const status = clientView ? clientStatus(order.status) : order.status;
  return (
    <Card onClick={onClick} className="animate-rise">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-muted">
          #{order.number} · {showAge ? t.minutesAgo(minutesSince(order.createdAt)) : `${dateTime(order.createdAt)}`}
        </div>
        <StatusBadge status={status} label={t.statusShort[status]} />
      </div>
      <RouteLine
        from={city(order.route.fromCity)}
        fromSub={order.pickup}
        to={city(order.route.toCity)}
        toSub={order.dropoff}
      />
      <div className="mt-3 border-t border-line/60 pt-3">
        <OrderMeta order={order} />
        {order.comment && <div className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-[13px]">💬 {order.comment}</div>}
      </div>
      {footer && <div className="mt-3">{footer}</div>}
    </Card>
  );
}

export function TimeChip({ iso }: { iso: string }) {
  return <span className="tabular-nums">{hhmm(iso)}</span>;
}
