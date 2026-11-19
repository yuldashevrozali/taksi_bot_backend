import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, Search, X } from "lucide-react";
import { ORDER_SOURCES, ORDER_STATUSES, type OrderDto, type OrderStatus, type Page } from "@taxi/shared";
import { dateTime, telHref } from "@taxi/web-core";
import { Btn, EmptyRow, PageHeader, Pager, Panel, SOURCE_LABEL, STATUS_LABEL, StatusBadge, api, cx, errorText, inputCls, toast } from "../core";

interface HistoryRow {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  by: string;
  note: string | null;
  createdAt: string;
}

function OrderDrawer({ order, onClose }: { order: OrderDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [reason, setReason] = useState("");
  const history = useQuery({ queryKey: ["order-history", order.id], queryFn: () => api.get<HistoryRow[]>(`/admin/orders/${order.id}/history`) });
  const save = useMutation({
    mutationFn: () => api.post<OrderDto>(`/admin/orders/${order.id}/status`, { status, reason: reason || undefined }),
    onSuccess: () => {
      toast.ok("Holat o'zgartirildi");
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const c = order.contact;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto bg-bg p-6 shadow-2xl animate-rise" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold">Buyurtma #{order.number}</h2>
          <button onClick={onClose} className="grid size-9 place-items-center rounded-xl hover:bg-surface-2">
            <X className="size-5" />
          </button>
        </div>
        <div className="space-y-4">
          <Panel>
            <div className="space-y-2 p-4 text-sm">
              <Row k="Yo'nalish" v={`${order.route.fromCity} → ${order.route.toCity}`} />
              <Row k="Qayerdan" v={order.pickup ?? "—"} />
              <Row k="Qayerga" v={order.dropoff ?? "—"} />
              <Row k="Turi" v={order.isParcel ? "📦 Pochta" : `👥 ${order.passengers}${order.passengersUnknown ? " (aniqlanmagan)" : ""} yo'lovchi`} />
              <Row k="Vaqt" v={order.isNow || !order.departureAt ? "Hozir / tez" : dateTime(order.departureAt)} />
              <Row k="Manba" v={SOURCE_LABEL[order.source]} />
              <Row k="Haydovchi" v={order.driver?.name ?? "—"} />
              {order.comment && <Row k="Izoh" v={order.comment} />}
              {order.voucherPercent && <Row k="Voucher" v={`${order.voucherPercent}%`} />}
            </div>
          </Panel>
          {c && (
            <Panel title="Mijoz">
              <div className="space-y-2 p-4 text-sm">
                <Row k="Ism" v={c.name ?? "—"} />
                {c.username && <Row k="Username" v={`@${c.username}`} />}
                {c.phone && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Telefon</span>
                    <a href={telHref(c.phone)} className="inline-flex items-center gap-1.5 font-semibold text-info">
                      <Phone className="size-3.5" />
                      {c.phone}
                    </a>
                  </div>
                )}
                {c.sourceText && <div className="mt-2 rounded-xl bg-surface-2 p-3 text-[13px] italic">{c.sourceText}</div>}
              </div>
            </Panel>
          )}
          <Panel title="Holatni o'zgartirish">
            <div className="space-y-3 p-4">
              <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <input className={inputCls} placeholder="Sabab (ixtiyoriy)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
              <div className="flex gap-2">
                <Btn loading={save.isPending} disabled={status === order.status} onClick={() => save.mutate()} className="flex-1">
                  Saqlash
                </Btn>
                {order.status !== "CANCELLED" && order.status !== "COMPLETED" && (
                  <Btn
                    variant="danger"
                    onClick={() => {
                      setStatus("CANCELLED");
                      if (window.confirm("Buyurtmani bekor qilasizmi?")) {
                        api
                          .post(`/admin/orders/${order.id}/status`, { status: "CANCELLED", reason: reason || undefined })
                          .then(() => {
                            toast.ok("Bekor qilindi");
                            void qc.invalidateQueries({ queryKey: ["orders"] });
                            onClose();
                          })
                          .catch((e: unknown) => toast.error(errorText(e)));
                      }
                    }}
                  >
                    Bekor qilish
                  </Btn>
                )}
              </div>
            </div>
          </Panel>
          <Panel title="Tarix">
            <ol className="space-y-3 p-4 text-sm">
              {history.data?.map((h, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />
                  <div>
                    <div className="font-medium">{STATUS_LABEL[h.toStatus]}</div>
                    <div className="text-xs text-muted">
                      {dateTime(h.createdAt)} · {h.by}
                      {h.note ? ` · ${h.note}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}

export function Orders() {
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<OrderDto | null>(null);
  const params = new URLSearchParams({ page: String(page), ...(status && { status }), ...(source && { source }), ...(q && { q }) });
  const list = useQuery({
    queryKey: ["orders", status, source, q, page],
    queryFn: () => api.get<Page<OrderDto>>(`/admin/orders?${params}`),
    refetchInterval: 15_000,
  });

  return (
    <>
      <PageHeader title="Buyurtmalar" subtitle="Holatni o'zgartirish, bekor qilish, manba" />
      <Panel>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative w-40">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input className={cx(inputCls, "pl-9")} placeholder="Raqam #" value={q} inputMode="numeric" onChange={(e) => { setQ(e.target.value.replace(/\D/g, "")); setPage(1); }} />
          </div>
          <select className={cx(inputCls, "w-44")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Barcha holatlar</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className={cx(inputCls, "w-40")} value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}>
            <option value="">Barcha manbalar</option>
            {ORDER_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th>#</th>
                <th>Yo'nalish</th>
                <th>Mijoz</th>
                <th>Yo'lovchi</th>
                <th>Vaqt</th>
                <th>Haydovchi</th>
                <th>Manba</th>
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.length === 0 && <EmptyRow cols={8} text="Buyurtma topilmadi" />}
              {list.data?.items.map((o) => (
                <tr key={o.id} className="cursor-pointer" onClick={() => setOpen(o)}>
                  <td className="font-semibold tabular-nums">{o.number}</td>
                  <td className="whitespace-nowrap">
                    {o.route.fromCity} → {o.route.toCity}
                    <div className="max-w-48 truncate text-xs text-muted">{[o.pickup, o.dropoff].filter(Boolean).join(" → ")}</div>
                  </td>
                  <td>
                    {o.contact?.name ?? "—"}
                    <div className="text-xs text-muted tabular-nums">{o.contact?.phone}</div>
                  </td>
                  <td className="tabular-nums">{o.isParcel ? "📦" : `${o.passengers}${o.passengersUnknown ? "?" : ""}`}</td>
                  <td className="whitespace-nowrap tabular-nums">{o.isNow ? <span className="font-semibold text-brand-strong">Hozir</span> : o.departureAt ? dateTime(o.departureAt) : "—"}<div className="text-xs text-muted">{dateTime(o.createdAt)}</div></td>
                  <td>{o.driver?.name ?? <span className="text-muted">—</span>}</td>
                  <td className="text-muted">{SOURCE_LABEL[o.source]}</td>
                  <td><StatusBadge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </Panel>
      {open && <OrderDrawer order={open} onClose={() => setOpen(null)} />}
    </>
  );
}
