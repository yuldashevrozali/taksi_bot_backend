import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Car, MessageSquare, Repeat2, Tag, X } from "lucide-react";
import type { OrderDto } from "@taxi/shared";
import { confirmDialog, dateTime, hhmm } from "@taxi/web-core";
import { api, useApp } from "../core";
import { clientStatus } from "../i18n";
import { OrderMeta, Page } from "../components";
import { Button, Card, RouteLine, Skeleton, StatusBadge, cx, toast } from "../ui";

// Clients see only two stages; "Yo'lda" / "Yakunlandi" are driver-side.
const STEPS = ["PENDING", "ACCEPTED"] as const;

export function OrderStatus({ id }: { id: string }) {
  const { t, city, push, errorText } = useApp();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["order", id],
    queryFn: () => api.get<OrderDto>(`/orders/${id}`),
    // Poll only while waiting for a driver.
    refetchInterval: (query) => (query.state.data && query.state.data.status !== "PENDING" ? false : 5_000),
  });
  const cancel = useMutation({
    mutationFn: () => api.post<OrderDto>(`/orders/${id}/cancel`),
    onSuccess: (o) => {
      qc.setQueryData(["order", id], o);
      void qc.invalidateQueries({ queryKey: ["orders"] });
      toast.ok(t.status.CANCELLED);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const o = q.data;
  if (!o) {
    return (
      <Page>
        <Skeleton className="mb-4 h-44" />
        <Skeleton className="h-40" />
      </Page>
    );
  }
  const status = clientStatus(o.status);
  const stepIndex = status === "ACCEPTED" ? 1 : 0;
  const stamps: Record<(typeof STEPS)[number], string | null> = { PENDING: o.createdAt, ACCEPTED: o.acceptedAt };

  return (
    <Page>
      {/* Hero */}
      <div
        className={cx(
          "relative mb-4 overflow-hidden rounded-3xl p-6 text-center animate-rise",
          status === "CANCELLED" ? "bg-surface-2" : status === "ACCEPTED" ? "bg-ok text-white" : "bg-ink text-bg",
        )}
      >
        <div className="relative mx-auto mb-4 grid size-20 place-items-center">
          {o.status === "PENDING" && <span className="pulse-ring absolute inset-2" />}
          <span
            className={cx(
              "relative grid size-20 place-items-center rounded-full text-4xl",
              status === "CANCELLED" ? "bg-surface" : status === "ACCEPTED" ? "bg-white/20" : "bg-brand",
            )}
          >
            {status === "ACCEPTED" ? "✅" : status === "CANCELLED" ? "✖️" : "🚕"}
          </span>
        </div>
        <div className="text-[13px] opacity-70">
          {t.order} #{o.number}
        </div>
        <div className="text-2xl font-bold">{t.status[status]}</div>
        <div className="mx-auto mt-2 max-w-72 text-sm opacity-90">{t.statusHint[status]}</div>
      </div>

      {/* Timeline */}
      {status !== "CANCELLED" && (
        <Card className="mb-4">
          <div className="flex items-start justify-between">
            {STEPS.map((s, i) => {
              const done = i <= stepIndex;
              return (
                <div key={s} className="relative flex flex-1 flex-col items-center text-center">
                  {i > 0 && (
                    <span className={cx("absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2", i <= stepIndex ? "bg-brand" : "bg-line")} />
                  )}
                  <span
                    className={cx(
                      "relative z-10 grid size-8 place-items-center rounded-full text-xs font-bold transition",
                      done ? "bg-brand text-brand-ink" : "bg-surface-2 text-muted",
                      i === stepIndex && status === "PENDING" && "ring-4 ring-brand/30",
                    )}
                  >
                    {done ? <Check className="size-4" /> : i + 1}
                  </span>
                  <span className={cx("mt-2 text-[11px] font-semibold leading-tight", done ? "text-ink" : "text-muted")}>{t.statusShort[s]}</span>
                  {stamps[s] && <span className="text-[11px] text-muted tabular-nums">{hhmm(stamps[s]!)}</span>}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Driver */}
      {o.driver && (
        <Card className="mb-4 flex items-center gap-4 animate-rise">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand/20">
            <Car className="size-6 text-brand-strong" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-muted">{t.driver}</div>
            <div className="truncate text-[17px] font-semibold">{o.driver.name}</div>
            <div className="truncate text-sm text-muted">
              {[o.driver.carColor, o.driver.carModel].filter(Boolean).join(" ")}
              {o.driver.carNumber && (
                <span className="ml-2 rounded-md border border-line px-1.5 py-0.5 font-mono text-xs text-ink">{o.driver.carNumber}</span>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Details */}
      <Card className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-semibold">{t.details}</div>
          <StatusBadge status={status} label={t.statusShort[status]} />
        </div>
        <RouteLine from={city(o.route.fromCity)} fromSub={o.pickup} to={city(o.route.toCity)} toSub={o.dropoff} />
        <div className="mt-3 border-t border-line/60 pt-3">
          <OrderMeta order={o} />
          {o.comment && (
            <div className="mt-2 flex gap-2 text-sm">
              <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted" /> {o.comment}
            </div>
          )}
          {o.voucherPercent && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-ok/12 px-2.5 py-1 text-xs font-semibold text-ok">
              <Tag className="size-3.5" /> {t.voucherApplied(o.voucherPercent)}
            </div>
          )}
          <div className="mt-2 text-xs text-muted">{dateTime(o.createdAt)}</div>
        </div>
      </Card>

      <div className="space-y-3">
        {(o.status === "PENDING" || o.status === "ACCEPTED") && (
          <Button
            variant="danger"
            block
            loading={cancel.isPending}
            onClick={async () => {
              if (await confirmDialog(t.cancelConfirm)) cancel.mutate();
            }}
          >
            <X className="size-5" /> {t.cancelOrder}
          </Button>
        )}
        {o.status !== "PENDING" && (
          <Button
            variant="secondary"
            block
            onClick={() =>
              push({
                name: "order-form",
                routeId: o.route.id,
                prefill: { pickup: o.pickup, dropoff: o.dropoff, passengers: o.passengersUnknown ? 1 : o.passengers, comment: o.comment },
              })
            }
          >
            <Repeat2 className="size-5" /> {t.repeat}
          </Button>
        )}
      </div>
    </Page>
  );
}
