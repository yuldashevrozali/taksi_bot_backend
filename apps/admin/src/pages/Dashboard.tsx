import { useQuery } from "@tanstack/react-query";
import { Ban, CheckCircle2, Clock, Car, ClipboardList, UserPlus, Users } from "lucide-react";
import type { AdminStatsDto, OrderDto, Page } from "@taxi/shared";
import { dateTime } from "@taxi/web-core";
import { PageHeader, Panel, SOURCE_LABEL, StatusBadge, api, cx } from "../core";

function Stat({ label, value, icon, tone }: { label: string; value: number | string; icon: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted">{label}</span>
        <span className={cx("grid size-9 place-items-center rounded-xl", tone)}>{icon}</span>
      </div>
      <div className="mt-3 text-3xl font-bold tabular-nums tracking-tight">{value}</div>
    </div>
  );
}

function WeekChart({ data }: { data: AdminStatsDto["last7Days"] }) {
  const max = Math.max(1, ...data.map((d) => d.orders));
  return (
    <div className="flex h-48 items-end gap-3 px-5 pb-4 pt-6">
      {data.map((d) => (
        <div key={d.date} className="flex flex-1 flex-col items-center gap-2">
          <div className="relative flex h-36 w-full max-w-12 items-end">
            <div className="absolute inset-x-0 bottom-0 rounded-lg bg-surface-2" style={{ height: `${(d.orders / max) * 100}%` }} />
            <div className="absolute inset-x-0 bottom-0 rounded-lg bg-brand" style={{ height: `${(d.completed / max) * 100}%` }} />
            <span className="absolute inset-x-0 -top-5 text-center text-xs font-semibold tabular-nums">{d.orders || ""}</span>
          </div>
          <span className="text-[11px] text-muted tabular-nums">{d.date.slice(8)}.{d.date.slice(5, 7)}</span>
        </div>
      ))}
    </div>
  );
}

export function Dashboard({ onOpenOrders }: { onOpenOrders: () => void }) {
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api.get<AdminStatsDto>("/admin/stats"), refetchInterval: 15_000 });
  const recent = useQuery({
    queryKey: ["orders", "recent"],
    queryFn: () => api.get<Page<OrderDto>>("/admin/orders?pageSize=8"),
    refetchInterval: 15_000,
  });
  const s = stats.data;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Bugungi holat (Toshkent vaqti)" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Bugungi buyurtmalar" value={s?.today.orders ?? "–"} icon={<ClipboardList className="size-5" />} tone="bg-brand/20 text-brand-strong" />
        <Stat label="Yakunlangan" value={s?.today.completed ?? "–"} icon={<CheckCircle2 className="size-5" />} tone="bg-ok/12 text-ok" />
        <Stat label="Bekor qilingan" value={s?.today.cancelled ?? "–"} icon={<Ban className="size-5" />} tone="bg-bad/10 text-bad" />
        <Stat label="Hozir kutilmoqda" value={s?.pendingNow ?? "–"} icon={<Clock className="size-5" />} tone="bg-warn/12 text-warn" />
        <Stat label="Yangi mijozlar (bugun)" value={s?.today.newClients ?? "–"} icon={<UserPlus className="size-5" />} tone="bg-info/12 text-info" />
        <Stat label="Faol haydovchilar" value={s?.activeDrivers ?? "–"} icon={<Car className="size-5" />} tone="bg-surface-2 text-ink" />
        <Stat label="Jami mijozlar" value={s?.totalClients ?? "–"} icon={<Users className="size-5" />} tone="bg-surface-2 text-ink" />
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="mb-3 text-sm font-medium text-muted">Bugun manba bo'yicha</div>
          <div className="space-y-1.5 text-sm">
            {s &&
              Object.entries(s.bySource).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-muted">{SOURCE_LABEL[k as keyof typeof SOURCE_LABEL]}</span>
                  <b className="tabular-nums">{v}</b>
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Panel
          className="xl:col-span-2"
          title="Oxirgi 7 kun"
          right={
            <div className="flex gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded bg-surface-2 ring-1 ring-line" />Jami</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded bg-brand" />Yakunlangan</span>
            </div>
          }
        >
          {s ? <WeekChart data={s.last7Days} /> : <div className="h-48" />}
        </Panel>
        <Panel className="xl:col-span-3" title="So'nggi buyurtmalar" right={<button onClick={onOpenOrders} className="text-sm font-semibold text-info">Barchasi →</button>}>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <tbody>
                {recent.data?.items.map((o) => (
                  <tr key={o.id}>
                    <td className="font-semibold tabular-nums">#{o.number}</td>
                    <td>
                      {o.route.fromCity} → {o.route.toCity}
                      <div className="text-xs text-muted">{o.contact?.name}</div>
                    </td>
                    <td className="text-muted tabular-nums">{dateTime(o.createdAt)}</td>
                    <td><StatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
