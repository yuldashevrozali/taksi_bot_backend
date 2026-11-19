import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Plus, Ticket, Trash2, UserPlus, Wallet } from "lucide-react";
import type { GroupMessageDto, Page, RouteDto, Settings } from "@taxi/shared";
import { dateTime } from "@taxi/web-core";
import { Btn, EmptyRow, PageHeader, Pager, Panel, api, cx, errorText, inputCls, toast } from "../core";

// ── Groups ──
interface GroupRow {
  id: string;
  chatId: string;
  title: string | null;
  isActive: boolean;
  botIsAdmin: boolean;
  canDelete: boolean;
  lastMessageAt: string | null;
}

const MESSAGE_TABS = [
  { value: "UNRECOGNIZED", label: "Aniqlanmagan" },
  { value: "ORDER_CREATED", label: "Buyurtmaga aylangan" },
  { value: "DRIVER_OFFER", label: "Haydovchi e'lonlari" },
  { value: "DUPLICATE", label: "Takroriy" },
] as const;

export function Groups() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<(typeof MESSAGE_TABS)[number]["value"]>("UNRECOGNIZED");
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api.get<GroupRow[]>("/admin/groups"), refetchInterval: 30_000 });
  const messages = useQuery({
    queryKey: ["group-messages", tab, page],
    queryFn: () => api.get<Page<GroupMessageDto>>(`/admin/groups/messages?result=${tab}&page=${page}`),
    refetchInterval: 30_000,
  });
  const toggle = useMutation({
    mutationFn: (g: GroupRow) => api.patch(`/admin/groups/${g.id}`, { isActive: !g.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["groups"] }),
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <>
      <PageHeader
        title="Guruhlar"
        subtitle="Bot admin qilingan ommaviy guruhlar avtomatik kuzatiladi. Haydovchilar guruhi kuzatilmaydi."
      />
      <Panel title="Kuzatilayotgan guruhlar" className="mb-6">
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr><th>Guruh</th><th>Chat ID</th><th>Bot admin</th><th>O'chira oladi</th><th>Oxirgi xabar</th><th>Monitoring</th></tr>
            </thead>
            <tbody>
              {groups.data?.length === 0 && <EmptyRow cols={6} text="Hali guruh yo'q. Botni ommaviy guruhga qo'shib, admin qiling." />}
              {groups.data?.map((g) => (
                <tr key={g.id}>
                  <td className="font-semibold">{g.title ?? "—"}</td>
                  <td className="font-mono text-xs">{g.chatId}</td>
                  <td>{g.botIsAdmin ? "✅" : <span title="Bot admin emas — xabarlarni ko'rmaydi">❌</span>}</td>
                  <td>{g.canDelete ? "✅" : <span title="Qabul qilingan xabarni o'chira olmaydi">❌</span>}</td>
                  <td className="text-muted">{g.lastMessageAt ? dateTime(g.lastMessageAt) : "—"}</td>
                  <td>
                    <button
                      onClick={() => toggle.mutate(g)}
                      className={cx("relative h-7 w-12 rounded-full transition", g.isActive ? "bg-ok" : "bg-line")}
                      aria-label="toggle"
                    >
                      <span className={cx("absolute top-1 size-5 rounded-full bg-white shadow transition-all", g.isActive ? "left-6" : "left-1")} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel
        title="Guruh xabarlari"
        right={
          <div className="flex flex-wrap gap-1">
            {MESSAGE_TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => {
                  setTab(t.value);
                  setPage(1);
                }}
                className={cx("rounded-lg px-3 py-1.5 text-xs font-semibold", tab === t.value ? "bg-brand text-brand-ink" : "text-muted hover:bg-surface-2")}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="divide-y divide-line">
          {messages.data?.items.length === 0 && <div className="py-12 text-center text-muted">Xabar yo'q</div>}
          {messages.data?.items.map((m) => (
            <div key={m.id} className="px-5 py-3.5">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-semibold text-ink">{m.senderName ?? "—"}</span>
                {m.senderUsername && <span>@{m.senderUsername}</span>}
                <span>· {dateTime(m.createdAt)}</span>
                <span className={cx("rounded-full px-2 py-0.5 font-semibold", m.confidence === "HIGH" ? "bg-ok/12 text-ok" : m.confidence === "MEDIUM" ? "bg-warn/12 text-warn" : "bg-surface-2")}>{m.confidence}</span>
              </div>
              <div className="whitespace-pre-wrap text-sm">{m.text}</div>
            </div>
          ))}
        </div>
        {messages.data && messages.data.total > 0 && <Pager page={page} pageSize={messages.data.pageSize} total={messages.data.total} onPage={setPage} />}
      </Panel>
    </>
  );
}

// ── Loyalty ──
interface LoyaltyStats {
  pointsIssued: number;
  pointsSpent: number;
  vouchersActive: number;
  vouchersUsed: number;
  referralBonusesGranted: number;
}

function useSettingsForm() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/admin/settings") });
  const [draft, setDraft] = useState<Partial<Settings>>({});
  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.put<Settings>("/admin/settings", patch),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      toast.ok("Saqlandi");
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return { draft, setDraft, save, loaded: Boolean(settings.data) };
}

function NumField({ label, hint, value, onChange }: { label: string; hint?: string; value: number | undefined; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-sm font-medium">{label}</div>
      <input className={inputCls} type="number" min={0} value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </label>
  );
}

export function Loyalty() {
  const stats = useQuery({ queryKey: ["loyalty-stats"], queryFn: () => api.get<LoyaltyStats>("/admin/loyalty/stats") });
  const { draft, setDraft, save, loaded } = useSettingsForm();
  const s = stats.data;
  const cards = [
    { label: "Berilgan ballar", value: s?.pointsIssued, icon: <Gift className="size-5" /> },
    { label: "Sarflangan ballar", value: s?.pointsSpent, icon: <Wallet className="size-5" /> },
    { label: "Faol voucherlar", value: s?.vouchersActive, icon: <Ticket className="size-5" /> },
    { label: "Ishlatilgan voucherlar", value: s?.vouchersUsed, icon: <Ticket className="size-5" /> },
    { label: "Referral bonuslari", value: s?.referralBonusesGranted, icon: <UserPlus className="size-5" /> },
  ];
  return (
    <>
      <PageHeader title="Loyalty" subtitle="Ball, chegirma va referral sozlamalari" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between text-sm text-muted">
              {c.label}
              <span className="text-brand-strong">{c.icon}</span>
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{c.value ?? "–"}</div>
          </div>
        ))}
      </div>
      <Panel title="Qiymatlar">
        <form
          className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              "loyalty.pointsPerTrip": draft["loyalty.pointsPerTrip"],
              "loyalty.pointsPerVoucher": draft["loyalty.pointsPerVoucher"],
              "loyalty.voucherPercent": draft["loyalty.voucherPercent"],
              "loyalty.maxEarningTripsPerDay": draft["loyalty.maxEarningTripsPerDay"],
              "referral.bonusPoints": draft["referral.bonusPoints"],
            });
          }}
        >
          <NumField label="Bir safar uchun ball" value={draft["loyalty.pointsPerTrip"]} onChange={(n) => setDraft({ ...draft, "loyalty.pointsPerTrip": n })} />
          <NumField label="Voucher narxi (ball)" value={draft["loyalty.pointsPerVoucher"]} onChange={(n) => setDraft({ ...draft, "loyalty.pointsPerVoucher": n })} />
          <NumField label="Chegirma foizi (%)" value={draft["loyalty.voucherPercent"]} onChange={(n) => setDraft({ ...draft, "loyalty.voucherPercent": n })} />
          <NumField
            label="Kuniga ball beriladigan safarlar"
            hint="Soxta safarlardan himoya: bir mijozga kuniga ko'pi bilan shuncha safar uchun ball"
            value={draft["loyalty.maxEarningTripsPerDay"]}
            onChange={(n) => setDraft({ ...draft, "loyalty.maxEarningTripsPerDay": n })}
          />
          <NumField
            label="Referral bonusi (ball)"
            hint="Taklif qilingan odamning birinchi safari yakunlanganda"
            value={draft["referral.bonusPoints"]}
            onChange={(n) => setDraft({ ...draft, "referral.bonusPoints": n })}
          />
          <div className="flex items-end">
            <Btn type="submit" loading={save.isPending} disabled={!loaded} className="w-full">
              Saqlash
            </Btn>
          </div>
        </form>
      </Panel>
      <p className="mt-3 text-sm text-muted">Ballni qaytarish (soxta safar): «Mijozlar» bo'limida «± Ball» tugmasi. Har bir o'zgarish audit logga yoziladi.</p>
    </>
  );
}

// ── Settings: routes, admins, support contact, audit ──
interface AdminRow {
  id: string;
  telegramId: string;
  name: string;
  username: string | null;
  fromEnv: boolean;
}
interface AuditRow {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  data: unknown;
  createdAt: string;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const routes = useQuery({ queryKey: ["admin-routes"], queryFn: () => api.get<RouteDto[]>("/admin/routes") });
  const admins = useQuery({ queryKey: ["admins"], queryFn: () => api.get<AdminRow[]>("/admin/admins") });
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api.get<AuditRow[]>("/admin/audit") });
  const { draft, setDraft, save, loaded } = useSettingsForm();
  const [newAdmin, setNewAdmin] = useState("");

  const toggleRoute = useMutation({
    mutationFn: (r: RouteDto) => api.patch(`/admin/routes/${r.id}`, { isActive: !r.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-routes"] }),
    onError: (e) => toast.error(errorText(e)),
  });
  const addAdmin = useMutation({
    mutationFn: () => api.post("/admin/admins", { telegramId: newAdmin.trim() }),
    onSuccess: () => {
      setNewAdmin("");
      toast.ok("Admin qo'shildi");
      void qc.invalidateQueries({ queryKey: ["admins"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const removeAdmin = useMutation({
    mutationFn: (id: string) => api.del(`/admin/admins/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admins"] }),
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <>
      <PageHeader title="Sozlamalar" subtitle="Yo'nalishlar, adminlar, operator kontakti va audit log" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Yo'nalishlar">
          <div className="divide-y divide-line">
            {routes.data?.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <div className="font-semibold">
                    {r.fromCity} → {r.toCity}
                  </div>
                  <div className="font-mono text-xs text-muted">{r.code}</div>
                </div>
                <button
                  onClick={() => toggleRoute.mutate(r)}
                  className={cx("relative h-7 w-12 rounded-full transition", r.isActive ? "bg-ok" : "bg-line")}
                  aria-label="toggle"
                >
                  <span className={cx("absolute top-1 size-5 rounded-full bg-white shadow transition-all", r.isActive ? "left-6" : "left-1")} />
                </button>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Operator kontakti" right={<span className="text-xs text-muted">Botdagi «☎️ Operator» tugmasi</span>}>
          <form
            className="flex gap-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({ "orders.unacceptedAlertMinutes": draft["orders.unacceptedAlertMinutes"], "support.contact": draft["support.contact"] ?? "" });
            }}
          >
            <div className="flex-1 space-y-3">
              <input className={inputCls} placeholder="+998 90 123 45 67 yoki @operator" value={draft["support.contact"] ?? ""} onChange={(e) => setDraft({ ...draft, "support.contact": e.target.value })} />
              <label className="flex items-center gap-3 text-sm">
                <span className="text-muted">Qabul qilinmagan buyurtma haqida eslatma (daqiqa):</span>
                <input
                  className={cx(inputCls, "w-24")}
                  type="number"
                  min={1}
                  value={draft["orders.unacceptedAlertMinutes"] ?? ""}
                  onChange={(e) => setDraft({ ...draft, "orders.unacceptedAlertMinutes": Number(e.target.value) })}
                />
              </label>
            </div>
            <Btn type="submit" loading={save.isPending} disabled={!loaded}>
              Saqlash
            </Btn>
          </form>
        </Panel>

        <Panel title="Adminlar">
          <form
            className="flex gap-3 border-b border-line p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{3,20}$/.test(newAdmin.trim())) addAdmin.mutate();
            }}
          >
            <input className={inputCls} placeholder="Telegram ID" inputMode="numeric" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} />
            <Btn type="submit" loading={addAdmin.isPending}>
              <Plus className="size-4" /> Qo'shish
            </Btn>
          </form>
          <div className="divide-y divide-line">
            {admins.data?.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="font-semibold">{a.name}</div>
                  <div className="text-xs text-muted">
                    {a.username && `@${a.username} · `}
                    <span className="font-mono">{a.telegramId}</span>
                    {a.fromEnv && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5">.env</span>}
                  </div>
                </div>
                {!a.fromEnv && (
                  <button
                    onClick={() => window.confirm(`${a.name} adminlikdan olinsinmi?`) && removeAdmin.mutate(a.id)}
                    className="grid size-9 place-items-center rounded-xl text-muted hover:bg-bad/10 hover:text-bad"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Audit log">
          <div className="max-h-96 divide-y divide-line overflow-y-auto">
            {audit.data?.length === 0 && <div className="py-10 text-center text-muted">Hali yozuv yo'q</div>}
            {audit.data?.map((a) => (
              <div key={a.id} className="px-5 py-2.5 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="font-mono text-xs font-semibold">{a.action}</span>
                  <span className="text-xs text-muted tabular-nums">{dateTime(a.createdAt)}</span>
                </div>
                <div className="truncate text-xs text-muted">
                  {a.actor} · {a.entityType} {a.data ? JSON.stringify(a.data) : ""}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
