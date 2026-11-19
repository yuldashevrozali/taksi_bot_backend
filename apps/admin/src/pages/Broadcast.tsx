import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, ExternalLink, Image as ImageIcon, Megaphone, Send, Square, Users, UserRound } from "lucide-react";
import type { BroadcastAudience, BroadcastDto } from "@taxi/shared";
import { ApiError, dateTime } from "@taxi/web-core";
import { Btn, PageHeader, Panel, api, cx, errorText, inputCls, toast } from "../core";

const AUDIENCES: { value: BroadcastAudience; label: string; icon: React.ReactNode }[] = [
  { value: "ALL", label: "Hammaga", icon: <Users className="size-4" /> },
  { value: "CLIENTS", label: "Mijozlarga", icon: <UserRound className="size-4" /> },
  { value: "DRIVERS", label: "Haydovchilarga", icon: <Car className="size-4" /> },
];

const STATUS: Record<BroadcastDto["status"], { label: string; cls: string }> = {
  QUEUED: { label: "Navbatda", cls: "bg-warn/12 text-warn" },
  RUNNING: { label: "Yuborilmoqda", cls: "bg-info/12 text-info" },
  DONE: { label: "Tugadi", cls: "bg-ok/12 text-ok" },
  CANCELLED: { label: "To'xtatildi", cls: "bg-surface-2 text-muted" },
};

function useRecipients(audience: BroadcastAudience) {
  return useQuery({
    queryKey: ["recipients", audience],
    queryFn: () => api.get<{ count: number }>(`/admin/broadcasts/recipients?audience=${audience}`),
    staleTime: 30_000,
  });
}

function AudienceButton({ a, active, onClick }: { a: (typeof AUDIENCES)[number]; active: boolean; onClick: () => void }) {
  const count = useRecipients(a.value).data?.count;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex flex-1 flex-col items-start gap-1 rounded-xl border p-3 text-left transition",
        active ? "border-brand bg-brand/10" : "border-line hover:bg-surface-2",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        {a.icon} {a.label}
      </span>
      <span className="text-xs text-muted">{count === undefined ? "…" : `${count} kishi`}</span>
    </button>
  );
}

/** Telegram-like preview bubble. */
function Preview({ text, photoUrl, buttonText }: { text: string; photoUrl: string; buttonText: string }) {
  const [imgError, setImgError] = useState(false);
  return (
    <div className="rounded-2xl bg-[#8fb4d8] p-4 dark:bg-[#0e1621]">
      <div className="max-w-sm overflow-hidden rounded-2xl rounded-bl-md bg-white text-[#0f1115] shadow dark:bg-[#182533] dark:text-white">
        {photoUrl &&
          (imgError ? (
            <div className="grid h-40 place-items-center bg-surface-2 text-xs text-muted">Rasm ochilmadi — havolani tekshiring</div>
          ) : (
            <img src={photoUrl} alt="" className="max-h-72 w-full object-cover" onError={() => setImgError(true)} onLoad={() => setImgError(false)} />
          ))}
        <div className="whitespace-pre-wrap break-words px-3 py-2 text-[15px] leading-snug">
          {text || <span className="opacity-40">Xabar matni shu yerda ko'rinadi…</span>}
        </div>
      </div>
      {buttonText && (
        <div className="mt-1 flex max-w-sm items-center justify-center gap-1.5 rounded-xl bg-white/40 py-2 text-sm font-semibold text-[#0f1115] dark:bg-[#182533]/70 dark:text-white">
          {buttonText} <ExternalLink className="size-3.5" />
        </div>
      )}
    </div>
  );
}

function Progress({ b }: { b: BroadcastDto }) {
  const done = b.sent + b.failed + b.blocked;
  const pct = b.total ? Math.min(100, Math.round((done / b.total) * 100)) : 0;
  return (
    <div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={cx("h-full rounded-full transition-all", b.status === "CANCELLED" ? "bg-muted" : "bg-brand")} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted tabular-nums">
        <span>
          {done}/{b.total} ({pct}%)
        </span>
        <span className="text-ok">✓ {b.sent}</span>
        {b.blocked > 0 && <span title="Botni bloklagan">⛔ {b.blocked}</span>}
        {b.failed > 0 && <span className="text-bad">✗ {b.failed}</span>}
      </div>
    </div>
  );
}

export function Broadcast() {
  const qc = useQueryClient();
  const [audience, setAudience] = useState<BroadcastAudience>("ALL");
  const [text, setText] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const recipients = useRecipients(audience).data?.count;

  const limit = photoUrl.trim() ? 1024 : 4096;
  const payload = () => ({
    text: text.trim(),
    audience,
    ...(photoUrl.trim() ? { photoUrl: photoUrl.trim() } : {}),
    ...(buttonText.trim() || buttonUrl.trim() ? { buttonText: buttonText.trim(), buttonUrl: buttonUrl.trim() } : {}),
  });
  const localError =
    !text.trim()
      ? "Matn kiriting"
      : text.length > limit
        ? `Matn ${limit} belgidan oshmasin${photoUrl.trim() ? " (rasm bilan)" : ""}`
        : photoUrl.trim() && !photoUrl.trim().startsWith("https://")
          ? "Rasm havolasi https:// bilan boshlansin"
          : Boolean(buttonText.trim()) !== Boolean(buttonUrl.trim())
            ? "Tugma uchun ham matn, ham havola kiriting"
            : buttonUrl.trim() && !buttonUrl.trim().startsWith("https://")
              ? "Tugma havolasi https:// bilan boshlansin"
              : null;

  const describe = (e: unknown) =>
    e instanceof ApiError && e.code === "telegram_rejected" ? `Telegram rad etdi: ${e.details?.[0]?.message ?? ""}` : e instanceof ApiError && e.code === "no_recipients" ? "Qabul qiluvchi yo'q" : errorText(e);

  const test = useMutation({
    mutationFn: () => api.post("/admin/broadcasts/test", payload()),
    onSuccess: () => toast.ok("Sizga yuborildi — Telegram'da tekshiring"),
    onError: (e) => toast.error(describe(e)),
  });
  const send = useMutation({
    mutationFn: () => api.post<BroadcastDto>("/admin/broadcasts", payload()),
    onSuccess: () => {
      toast.ok("Tarqatish boshlandi");
      setText("");
      setPhotoUrl("");
      setButtonText("");
      setButtonUrl("");
      void qc.invalidateQueries({ queryKey: ["broadcasts"] });
    },
    onError: (e) => toast.error(describe(e)),
  });
  const history = useQuery({
    queryKey: ["broadcasts"],
    queryFn: () => api.get<BroadcastDto[]>("/admin/broadcasts"),
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === "RUNNING" || b.status === "QUEUED") ? 2_000 : 15_000),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/admin/broadcasts/${id}/cancel`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["broadcasts"] }),
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <>
      <PageHeader title="Reklama" subtitle="Botga /start bosgan foydalanuvchilarga xabar tarqatish" />
      <div className="grid gap-6 xl:grid-cols-5">
        <Panel title="Yangi xabar" className="xl:col-span-3">
          <div className="space-y-4 p-5">
            <div>
              <div className="mb-2 text-sm font-medium">Kimga</div>
              <div className="flex flex-wrap gap-2">
                {AUDIENCES.map((a) => (
                  <AudienceButton key={a.value} a={a} active={audience === a.value} onClick={() => setAudience(a.value)} />
                ))}
              </div>
            </div>
            <label className="block">
              <div className="mb-1.5 flex justify-between text-sm font-medium">
                <span>Matn *</span>
                <span className={cx("text-xs tabular-nums", text.length > limit ? "text-bad" : "text-muted")}>
                  {text.length}/{limit}
                </span>
              </div>
              <textarea
                className={cx(inputCls, "h-40 resize-y py-2.5 leading-relaxed")}
                placeholder={"🚕 Farg'ona – Qo'qon taksi\nBugun barcha safarlarga 10% chegirma!"}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <label className="block">
              <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                <ImageIcon className="size-4" /> Rasm havolasi (ixtiyoriy)
              </div>
              <input className={inputCls} placeholder="https://.../rasm.jpg" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1.5 text-sm font-medium">Tugma matni (ixtiyoriy)</div>
                <input className={inputCls} placeholder="🚕 Buyurtma berish" value={buttonText} maxLength={64} onChange={(e) => setButtonText(e.target.value)} />
              </label>
              <label className="block">
                <div className="mb-1.5 text-sm font-medium">Tugma havolasi</div>
                <input className={inputCls} placeholder="https://t.me/…" value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} />
              </label>
            </div>
            {localError && text && <div className="text-sm text-bad">{localError}</div>}
            <div className="flex flex-wrap gap-3 border-t border-line pt-4">
              <Btn variant="secondary" disabled={Boolean(localError)} loading={test.isPending} onClick={() => test.mutate()}>
                <Send className="size-4" /> Menga sinab yuborish
              </Btn>
              <Btn
                disabled={Boolean(localError) || !recipients}
                loading={send.isPending}
                onClick={() => {
                  const label = AUDIENCES.find((a) => a.value === audience)!.label.toLowerCase();
                  if (window.confirm(`Xabar ${recipients} kishiga (${label}) yuboriladi. Davom etasizmi?`)) send.mutate();
                }}
              >
                <Megaphone className="size-4" /> Yuborish{recipients ? ` (${recipients} kishi)` : ""}
              </Btn>
            </div>
          </div>
        </Panel>
        <Panel title="Ko'rinishi" className="xl:col-span-2">
          <div className="p-5">
            <Preview text={text} photoUrl={photoUrl.trim()} buttonText={buttonText.trim()} />
            <p className="mt-3 text-xs text-muted">
              Avval «Menga sinab yuborish» bilan tekshiring. Xabar soniyasiga ~20 tadan yuboriladi; botni bloklaganlar keyingi safar o'tkazib yuboriladi.
            </p>
          </div>
        </Panel>
      </div>

      <Panel title="Tarix" className="mt-6">
        <div className="divide-y divide-line">
          {history.data?.length === 0 && <div className="py-12 text-center text-muted">Hali reklama yuborilmagan</div>}
          {history.data?.map((b) => (
            <div key={b.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_260px_auto] md:items-center">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className={cx("rounded-full px-2 py-0.5 font-semibold", STATUS[b.status].cls)}>{STATUS[b.status].label}</span>
                  <span>{AUDIENCES.find((a) => a.value === b.audience)?.label}</span>
                  <span>· {dateTime(b.createdAt)}</span>
                  <span>· {b.createdBy}</span>
                  {b.photoUrl && <ImageIcon className="size-3.5" />}
                </div>
                <div className="line-clamp-2 whitespace-pre-wrap text-sm">{b.text}</div>
              </div>
              <Progress b={b} />
              <div className="text-right">
                {(b.status === "RUNNING" || b.status === "QUEUED") && (
                  <Btn variant="danger" loading={cancel.isPending && cancel.variables === b.id} onClick={() => window.confirm("Tarqatishni to'xtatasizmi?") && cancel.mutate(b.id)}>
                    <Square className="size-3.5" /> To'xtatish
                  </Btn>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
