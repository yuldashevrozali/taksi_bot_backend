import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownUp, ChevronRight, Gift, MapPin, Star } from "lucide-react";
import type { FavoriteDto, LoyaltyDto, RouteDto } from "@taxi/shared";
import { haptic } from "@taxi/web-core";
import { api, useApp, useOrders } from "../core";
import { clientStatus } from "../i18n";
import { Page } from "../components";
import { Button, Card, RouteLine, Skeleton, StatusBadge } from "../ui";

export function Home() {
  const { me, t, city, push } = useApp();
  const routes = useQuery({ queryKey: ["routes"], queryFn: () => api.get<RouteDto[]>("/routes") });
  const orders = useOrders();
  const favorites = useQuery({ queryKey: ["favorites"], queryFn: () => api.get<FavoriteDto[]>("/favorites") });
  const loyalty = useQuery({ queryKey: ["loyalty"], queryFn: () => api.get<LoyaltyDto>("/loyalty") });
  const [index, setIndex] = useState(0);

  const list = routes.data ?? [];
  const selected = list[index % Math.max(list.length, 1)];
  const active = orders.data?.find((o) => ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(o.status));

  return (
    <Page>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between animate-rise">
        <div>
          <div className="text-sm text-muted">{t.hello(me.firstName ?? "")}</div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{t.whereTo}</h1>
        </div>
        <button
          onClick={() => push({ name: "profile" })}
          className="flex items-center gap-1.5 rounded-full bg-brand/20 px-3 py-2 text-sm font-bold text-[#8a6100] dark:text-brand"
        >
          <Gift className="size-4" />
          {loyalty.data ? loyalty.data.balance : "–"}
        </button>
      </div>

      {/* Active order banner */}
      {active && (
        <Card onClick={() => push({ name: "order", id: active.id })} className="mb-4 border-brand/50 bg-brand/10 animate-rise">
          <div className="flex items-center gap-3">
            <div className="relative grid size-10 shrink-0 place-items-center">
              {active.status === "PENDING" && <span className="pulse-ring absolute inset-1" />}
              <span className="relative grid size-10 place-items-center rounded-full bg-brand text-lg">🚕</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-muted">
                {t.activeOrder} #{active.number}
              </div>
              <div className="truncate font-semibold">{t.status[clientStatus(active.status)]}</div>
            </div>
            <StatusBadge status={clientStatus(active.status)} label={t.statusShort[clientStatus(active.status)]} />
            <ChevronRight className="size-5 text-muted" />
          </div>
        </Card>
      )}

      {/* Route picker */}
      <Card className="relative overflow-hidden p-5 animate-rise">
        <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-brand/15 blur-2xl" />
        {routes.isLoading || !selected ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-6 w-32" />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">{t.from}</div>
              <div className="mb-4 text-2xl font-bold">{city(selected.fromCity)}</div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">{t.to}</div>
              <div className="text-2xl font-bold">{city(selected.toCity)}</div>
            </div>
            {list.length > 1 && (
              <button
                aria-label={t.swap}
                onClick={() => {
                  haptic.select();
                  setIndex((i) => i + 1);
                }}
                className="grid size-14 place-items-center rounded-2xl bg-ink text-bg shadow-lg transition active:rotate-180 active:scale-95"
              >
                <ArrowDownUp className="size-6" />
              </button>
            )}
          </div>
        )}
        <Button block className="mt-5" disabled={!selected} onClick={() => selected && push({ name: "order-form", routeId: selected.id })}>
          🚕 {t.orderTaxi}
        </Button>
        <div className="mt-3 text-center text-xs text-muted">{t.priceNote}</div>
      </Card>

      {/* Favorites */}
      {(favorites.data?.length ?? 0) > 0 && (
        <>
          <div className="mb-2 mt-6 flex items-center gap-2 px-1 text-[15px] font-semibold text-muted">
            <Star className="size-4" /> {t.favorites}
          </div>
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
            {favorites.data!.map((f) => (
              <Card
                key={f.id}
                onClick={() => push({ name: "order-form", routeId: f.route.id, prefill: { pickup: f.pickup, dropoff: f.dropoff } })}
                className="w-64 shrink-0 snap-start"
              >
                <RouteLine
                  from={city(f.route.fromCity)}
                  fromSub={f.pickup || null}
                  to={city(f.route.toCity)}
                  toSub={f.dropoff || null}
                />
              </Card>
            ))}
          </div>
        </>
      )}

      {/* All routes quick list */}
      {list.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3">
          {list.map((r) => (
            <Card key={r.id} onClick={() => push({ name: "order-form", routeId: r.id })} className="p-3.5">
              <MapPin className="mb-2 size-5 text-brand-strong" />
              <div className="text-[13px] text-muted">{city(r.fromCity)}</div>
              <div className="font-semibold">→ {city(r.toCity)}</div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
