import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import type { AdminDriverDto, AdminUserDto, Page } from "@taxi/shared";
import { ddmmyyyy } from "@taxi/web-core";
import { Btn, EmptyRow, PageHeader, Pager, Panel, api, cx, errorText, inputCls, toast } from "../core";

export function Drivers() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["drivers"], queryFn: () => api.get<AdminDriverDto[]>("/admin/drivers") });
  const [form, setForm] = useState({ telegramId: "", carModel: "", carNumber: "", carColor: "" });
  const add = useMutation({
    mutationFn: () =>
      api.post("/admin/drivers", {
        telegramId: form.telegramId.trim(),
        carModel: form.carModel || undefined,
        carNumber: form.carNumber || undefined,
        carColor: form.carColor || undefined,
      }),
    onSuccess: () => {
      toast.ok("Haydovchi qo'shildi");
      setForm({ telegramId: "", carModel: "", carNumber: "", carColor: "" });
      void qc.invalidateQueries({ queryKey: ["drivers"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const toggle = useMutation({
    mutationFn: (d: AdminDriverDto) => api.patch(`/admin/drivers/${d.id}`, { isActive: !d.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["drivers"] }),
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <>
      <PageHeader title="Haydovchilar" subtitle="Haydovchi avval botga /start bosadi, keyin Telegram ID bilan qo'shiladi" />
      <Panel title="Yangi haydovchi qo'shish" className="mb-6">
        <form
          className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{3,20}$/.test(form.telegramId.trim())) add.mutate();
            else toast.error("Telegram ID faqat raqamlardan iborat");
          }}
        >
          <input className={inputCls} placeholder="Telegram ID *" inputMode="numeric" value={form.telegramId} onChange={(e) => setForm({ ...form, telegramId: e.target.value })} />
          <input className={inputCls} placeholder="Mashina (Cobalt)" value={form.carModel} onChange={(e) => setForm({ ...form, carModel: e.target.value })} />
          <input className={inputCls} placeholder="Raqam (40A123BC)" value={form.carNumber} onChange={(e) => setForm({ ...form, carNumber: e.target.value })} />
          <input className={inputCls} placeholder="Rang" value={form.carColor} onChange={(e) => setForm({ ...form, carColor: e.target.value })} />
          <Btn type="submit" loading={add.isPending}>
            <Plus className="size-4" /> Qo'shish
          </Btn>
        </form>
      </Panel>
      <Panel>
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th>Haydovchi</th>
                <th>Telegram ID</th>
                <th>Telefon</th>
                <th>Mashina</th>
                <th>Faol / Yakunlangan</th>
                <th>Bot</th>
                <th>Holat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.length === 0 && <EmptyRow cols={8} text="Hali haydovchi yo'q" />}
              {list.data?.map((d) => (
                <tr key={d.id} className={cx(!d.isActive && "opacity-55")}>
                  <td>
                    <div className="font-semibold">{d.name}</div>
                    {d.username && <div className="text-xs text-muted">@{d.username}</div>}
                  </td>
                  <td className="font-mono text-xs">{d.telegramId}</td>
                  <td className="tabular-nums">{d.phone ?? "—"}</td>
                  <td>
                    {[d.carColor, d.carModel].filter(Boolean).join(" ") || "—"}
                    {d.carNumber && <span className="ml-2 rounded border border-line px-1.5 py-0.5 font-mono text-xs">{d.carNumber}</span>}
                  </td>
                  <td className="tabular-nums">
                    {d.activeOrders} / {d.completedOrders}
                  </td>
                  <td>{d.botStarted ? <span className="text-ok">✓</span> : <span className="text-warn" title="/start bosilmagan">!</span>}</td>
                  <td>
                    <span className={cx("rounded-full px-2.5 py-1 text-xs font-semibold", d.isActive ? "bg-ok/12 text-ok" : "bg-surface-2 text-muted")}>
                      {d.isActive ? "Faol" : "O'chirilgan"}
                    </span>
                  </td>
                  <td className="text-right">
                    <Btn
                      variant={d.isActive ? "danger" : "secondary"}
                      loading={toggle.isPending && toggle.variables?.id === d.id}
                      onClick={() => {
                        if (!d.isActive || window.confirm(`${d.name} o'chirilsinmi? U boshqa buyurtma qabul qila olmaydi.`)) toggle.mutate(d);
                      }}
                    >
                      {d.isActive ? "O'chirish" : "Faollashtirish"}
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

export function Users() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["users", search, page],
    queryFn: () => api.get<Page<AdminUserDto>>(`/admin/users?page=${page}&q=${encodeURIComponent(search)}`),
  });
  const adjust = useMutation({
    mutationFn: (v: { userId: string; amount: number; note: string }) => api.post("/admin/loyalty/adjust", v),
    onSuccess: () => {
      toast.ok("Ball o'zgartirildi");
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <>
      <PageHeader title="Mijozlar" subtitle="Ism, username, telefon yoki Telegram ID bo'yicha qidiring" />
      <Panel>
        <form
          className="flex gap-3 border-b border-line p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
            setPage(1);
          }}
        >
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input className={cx(inputCls, "pl-9")} placeholder="Qidirish..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Btn type="submit" variant="secondary">Qidirish</Btn>
        </form>
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th>Foydalanuvchi</th>
                <th>Telefon</th>
                <th>Rol</th>
                <th>Buyurtmalar</th>
                <th>Ball</th>
                <th>Ro'yxatdan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.items.length === 0 && <EmptyRow cols={7} text="Topilmadi" />}
              {list.data?.items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="font-semibold">{u.name}</div>
                    <div className="text-xs text-muted">
                      {u.username ? `@${u.username} · ` : ""}
                      <span className="font-mono">{u.telegramId}</span>
                    </div>
                  </td>
                  <td className="tabular-nums">{u.phone ?? "—"}</td>
                  <td>
                    <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold">{u.role}</span>
                  </td>
                  <td className="tabular-nums">{u.ordersCount}</td>
                  <td className="font-semibold tabular-nums">{u.points}</td>
                  <td className="text-muted">{ddmmyyyy(u.createdAt)}</td>
                  <td className="text-right">
                    <Btn
                      variant="ghost"
                      onClick={() => {
                        const raw = window.prompt(`${u.name}: ball qo'shish (+) yoki ayirish (-)`, "-10");
                        if (!raw) return;
                        const amount = Number.parseInt(raw, 10);
                        if (!Number.isFinite(amount) || amount === 0) return void toast.error("Noto'g'ri son");
                        const note = window.prompt("Sabab (majburiy, audit uchun)", amount < 0 ? "Soxta safar" : "Bonus");
                        if (note && note.trim().length >= 2) adjust.mutate({ userId: u.id, amount, note: note.trim() });
                      }}
                    >
                      ± Ball
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </Panel>
    </>
  );
}
