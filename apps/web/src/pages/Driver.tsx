import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, History, Inbox, MessageCircle, Navigation, Phone, Search, Ticket, User as UserIcon } from "lucide-react";
import type { OrderDto, VoucherLookupDto } from "@taxi/shared";
import { confirmDialog, dateTime, telHref, tgHref } from "@taxi/web-core";
import { api, useApp } from "../core";
import { OrderCard, Page } from "../components";
import { Button, Card, Empty, Field, Skeleton, StatusBadge, cx, inputClass, toast } from "../ui";

function ModeSwitch() {
  const { t, setMode } = useApp();
  return (
    <button onClick={() => setMode("client")} className="rounded-full bg-surface-2 px-3 py-2 text-xs font-semibold text-muted">
      {t.clientMode}
    </button>
  );
}

export function DriverNew() {
  const { t, reset, errorText } = useApp();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["d-available"],
    queryFn: () => api.get<OrderDto[]>("/driver/orders/available"),
    refetchInterval: 5_000,
  });
  const accept = useMutation({
    mutationFn: (id: string) => api.post<OrderDto>(`/driver/orders/${id}/accept`),
    onSuccess: () => {
      toast.ok(t.accepted);
      void qc.invalidateQueries({ queryKey: ["d-available"] });
      void qc.invalidateQueries({ queryKey: ["d-mine"] });
      reset({ name: "d-mine" });
    },
    onError: (e) => {
      toast.error(errorText(e));
      void qc.invalidateQueries({ queryKey: ["d-available"] });
    },
  });

  return (
    <Page
      title={t.newOrders}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 animate-pulse rounded-full bg-ok" /> Live
        </span>
      }
      right={<ModeSwitch />}
    >
      {q.isLoading && <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-48" />)}</div>}
      {q.data?.length === 0 && <Empty icon={<Inbox className="size-7" />} title={t.noNewOrders} hint={t.noNewOrdersHint} />}
      <div className="space-y-3">
        {q.data?.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            showAge
            footer={
              <Button block loading={accept.isPending && accept.variables === o.id} onClick={() => accept.mutate(o.id)}>
                <CheckCircle2 className="size-5" /> {t.accept}
              </Button>
            }
          />
        ))}
      </div>
    </Page>
  );
}

function ContactBlock({ order }: { order: OrderDto }) {
  const { t } = useApp();
  const c = order.contact;
  if (!c) return null;
  const chat = tgHref(c);
  return (
    <div className="mt-3 rounded-2xl bg-surface-2 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <UserIcon className="size-4 text-muted" />
        <span className="font-semibold">{c.name ?? t.client}</span>
        {c.username && <span className="text-muted">@{c.username}</span>}
      </div>
      {c.phone && <div className="mb-3 font-mono text-[17px] font-semibold tracking-wide">{c.phone}</div>}
      <div className="grid grid-cols-2 gap-2">
        {c.phone ? (
          <a href={telHref(c.phone)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-ok text-[15px] font-semibold text-white active:opacity-90">
            <Phone className="size-4" /> {t.call}
          </a>
        ) : (
          <span />
        )}
        {chat && (
          <a href={chat} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-xl bg-info text-[15px] font-semibold text-white active:opacity-90">
            <MessageCircle className="size-4" /> {t.write}
          </a>
        )}
      </div>
      {c.sourceText && (
        <div className="mt-3 border-t border-line/60 pt-2 text-[13px]">
          <div className="mb-1 text-xs font-semibold text-muted">{t.originalMessage}</div>
          <div className="whitespace-pre-wrap italic">{c.sourceText}</div>
        </div>
      )}
    </div>
  );
}

export function DriverMine() {
  const { t, errorText } = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["d-mine"], queryFn: () => api.get<OrderDto[]>("/driver/orders/mine"), refetchInterval: 10_000 });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "IN_PROGRESS" | "COMPLETED" }) =>
      api.post<{ order: OrderDto }>(`/driver/orders/${id}/status`, { status }),
    onSuccess: (_r, v) => {
      toast.ok(v.status === "COMPLETED" ? `🏁 ${t.statusShort.COMPLETED}` : `🚗 ${t.statusShort.IN_PROGRESS}`);
      void qc.invalidateQueries({ queryKey: ["d-mine"] });
      void qc.invalidateQueries({ queryKey: ["d-history"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Page title={t.myActive} right={<ModeSwitch />}>
      {q.isLoading && <Skeleton className="h-64" />}
      {q.data?.length === 0 && <Empty icon={<Navigation className="size-7" />} title={t.noActive} />}
      <div className="space-y-3">
        {q.data?.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            footer={
              <>
                <ContactBlock order={o} />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={o.status !== "ACCEPTED"}
                    loading={setStatus.isPending && setStatus.variables?.id === o.id && setStatus.variables.status === "IN_PROGRESS"}
                    onClick={() => setStatus.mutate({ id: o.id, status: "IN_PROGRESS" })}
                  >
                    🚗 {t.markInProgress}
                  </Button>
                  <Button
                    size="md"
                    loading={setStatus.isPending && setStatus.variables?.id === o.id && setStatus.variables.status === "COMPLETED"}
                    onClick={async () => {
                      if (await confirmDialog(t.completeConfirm)) setStatus.mutate({ id: o.id, status: "COMPLETED" });
                    }}
                  >
                    🏁 {t.markCompleted}
                  </Button>
                </div>
              </>
            }
          />
        ))}
      </div>
    </Page>
  );
}

export function DriverHistory() {
  const { t, city } = useApp();
  const q = useQuery({ queryKey: ["d-history"], queryFn: () => api.get<OrderDto[]>("/driver/orders/history"), refetchInterval: 30_000 });
  return (
    <Page title={t.allOrders} right={<ModeSwitch />}>
      {q.isLoading && <Skeleton className="h-64" />}
      {q.data?.length === 0 && <Empty icon={<History className="size-7" />} title={t.noOrders} />}
      <Card className="divide-y divide-line/60 p-0">
        {q.data?.map((o) => (
          <div key={o.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">
                {city(o.route.fromCity)} → {city(o.route.toCity)}
              </div>
              <div className="truncate text-xs text-muted">
                #{o.number} · {dateTime(o.createdAt)} · {o.driver?.name ?? "—"}
              </div>
            </div>
            <StatusBadge status={o.status} label={t.statusShort[o.status]} />
          </div>
        ))}
      </Card>
    </Page>
  );
}

export function DriverVoucher() {
  const { t, errorText } = useApp();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<VoucherLookupDto | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: () => api.get<VoucherLookupDto>(`/driver/vouchers/lookup?q=${encodeURIComponent(query.trim())}`),
    onSuccess: (r) => {
      setResult(r);
      setSelectedOrder(r.eligibleOrders[0]?.id ?? null);
    },
    onError: (e) => {
      setResult(null);
      toast.error(errorText(e));
    },
  });
  const apply = useMutation({
    mutationFn: (voucherId: string) => api.post(`/driver/vouchers/${voucherId}/apply`, { orderId: selectedOrder }),
    onSuccess: () => {
      toast.ok(`✅ ${t.applied}`);
      lookup.mutate();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Page title={t.voucherCheck} subtitle={t.voucherCheckHint} right={<ModeSwitch />}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim().length >= 3) lookup.mutate();
        }}
      >
        <div className="flex-1">
          <Field icon={<Search className="size-5" />}>
            <input className={inputClass} placeholder="@username / +998..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" size="lg" className="w-14 px-0" loading={lookup.isPending} aria-label={t.search}>
          <Search className="size-5" />
        </Button>
      </form>

      {result && (
        <div className="mt-5 space-y-4 animate-rise">
          <Card className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-surface-2">
              <UserIcon className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="truncate font-semibold">{result.client.name ?? "—"}</div>
              <div className="truncate text-sm text-muted">
                {[result.client.username && `@${result.client.username}`, result.client.phoneMasked].filter(Boolean).join(" · ")}
              </div>
            </div>
          </Card>

          {result.vouchers.length === 0 ? (
            <Empty icon={<Ticket className="size-7" />} title={t.noActiveVouchers} />
          ) : result.eligibleOrders.length === 0 ? (
            <Card className="text-center text-sm text-muted">{t.noEligible}</Card>
          ) : (
            <>
              <div>
                <div className="mb-2 px-1 text-[13px] font-medium text-muted">{t.applyTo}</div>
                <div className="flex flex-wrap gap-2">
                  {result.eligibleOrders.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setSelectedOrder(o.id)}
                      className={cx(
                        "rounded-xl border px-3 py-2 text-sm font-semibold",
                        selectedOrder === o.id ? "border-brand bg-brand/15" : "border-line bg-surface",
                      )}
                    >
                      #{o.number} · {dateTime(o.createdAt)}
                    </button>
                  ))}
                </div>
              </div>
              {result.vouchers.map((v) => (
                <Card key={v.id} className="flex items-center gap-4 border-dashed border-brand bg-brand/10">
                  <Ticket className="size-8 text-brand-strong" />
                  <div className="flex-1 text-2xl font-extrabold">-{v.percent}%</div>
                  <Button size="md" disabled={!selectedOrder} loading={apply.isPending && apply.variables === v.id} onClick={() => apply.mutate(v.id)}>
                    {t.apply}
                  </Button>
                </Card>
              ))}
            </>
          )}
        </div>
      )}
    </Page>
  );
}

/** Opened from the drivers-group "Buyurtmani olish" button. */
export function DriverOrder({ id }: { id: string }) {
  const { t, reset, errorText } = useApp();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["d-order", id],
    queryFn: () => api.get<OrderDto>(`/driver/orders/${id}`),
    refetchInterval: (query) => (query.state.data?.status === "PENDING" ? 4_000 : false),
  });
  const accept = useMutation({
    mutationFn: () => api.post<OrderDto>(`/driver/orders/${id}/accept`),
    onSuccess: (o) => {
      qc.setQueryData(["d-order", id], o);
      void qc.invalidateQueries({ queryKey: ["d-mine"] });
      void qc.invalidateQueries({ queryKey: ["d-available"] });
      toast.ok(t.accepted);
    },
    onError: (e) => {
      toast.error(errorText(e));
      void q.refetch();
    },
  });

  if (q.error) {
    return (
      <Page>
        <Empty icon={<Inbox className="size-7" />} title={errorText(q.error)} action={<Button size="md" onClick={() => reset({ name: "d-new" })}>{t.toNewOrders}</Button>} />
      </Page>
    );
  }
  const o = q.data;
  if (!o) {
    return (
      <Page>
        <Skeleton className="h-72" />
      </Page>
    );
  }
  const mine = Boolean(o.contact);
  return (
    <Page title={t.newClient} subtitle={`#${o.number}`}>
      <OrderCard order={o} showAge />
      <div className="mt-4">
        {o.status === "PENDING" ? (
          <Button block loading={accept.isPending} onClick={() => accept.mutate()}>
            <CheckCircle2 className="size-5" /> {t.takeOrder}
          </Button>
        ) : mine ? (
          <Card className="border-ok/40 bg-ok/10">
            <div className="flex items-center gap-2 font-semibold text-ok">
              <CheckCircle2 className="size-5" /> {t.yourOrder}
            </div>
            <ContactBlock order={o} />
            <Button variant="secondary" block className="mt-3" onClick={() => reset({ name: "d-mine" })}>
              {t.myActive} →
            </Button>
          </Card>
        ) : (
          <Empty
            icon={<Inbox className="size-7" />}
            title={t.orderGone}
            action={<Button size="md" onClick={() => reset({ name: "d-new" })}>{t.toNewOrders}</Button>}
          />
        )}
      </div>
    </Page>
  );
}
