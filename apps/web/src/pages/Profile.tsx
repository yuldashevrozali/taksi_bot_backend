import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, ClipboardList, Copy, Gift, Languages, Send, Shield, Sparkles, Star, Ticket, Trash2, UserPlus } from "lucide-react";
import type { FavoriteDto, Language, LoyaltyDto } from "@taxi/shared";
import { confirmDialog, ddmmyyyy, openTelegramLink } from "@taxi/web-core";
import { API_URL, api, useApp, useOrders } from "../core";
import { OrderCard, Page } from "../components";
import { Button, Card, Empty, Segmented, SectionTitle, Skeleton, cx, toast } from "../ui";

export function Orders() {
  const { t, push, reset } = useApp();
  const q = useOrders();
  return (
    <Page title={t.myOrders}>
      {q.isLoading && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>}
      {q.data?.length === 0 && (
        <Empty
          icon={<ClipboardList className="size-7" />}
          title={t.noOrders}
          hint={t.noOrdersHint}
          action={<Button size="md" onClick={() => reset({ name: "home" })}>🚕 {t.orderTaxi}</Button>}
        />
      )}
      <div className="space-y-3">
        {q.data?.map((o) => <OrderCard key={o.id} order={o} clientView onClick={() => push({ name: "order", id: o.id })} />)}
      </div>
    </Page>
  );
}

export function Profile() {
  const { me, t, lang, city, setLanguage, setMode, push, errorText } = useApp();
  const qc = useQueryClient();
  const loyalty = useQuery({ queryKey: ["loyalty"], queryFn: () => api.get<LoyaltyDto>("/loyalty") });
  const favorites = useQuery({ queryKey: ["favorites"], queryFn: () => api.get<FavoriteDto[]>("/favorites") });

  const redeem = useMutation({
    mutationFn: () => api.post("/loyalty/redeem"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["loyalty"] });
      toast.ok("🎉 Voucher!");
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const removeFav = useMutation({
    mutationFn: (id: string) => api.del(`/favorites/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["favorites"] });
      toast.ok(t.removed);
    },
  });

  const l = loyalty.data;
  const progress = l ? Math.min(100, Math.round((Math.max(l.balance, 0) / l.pointsPerVoucher) * 100)) : 0;
  const initials = (me.firstName ?? "?").slice(0, 1).toUpperCase();

  return (
    <Page>
      {/* User */}
      <div className="mb-5 flex items-center gap-4 animate-rise">
        <div className="grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-brand to-brand-strong text-2xl font-bold text-brand-ink">{initials}</div>
        <div className="min-w-0">
          <div className="truncate text-xl font-bold">{me.firstName}</div>
          <div className="truncate text-sm text-muted">{[me.username && `@${me.username}`, me.phone].filter(Boolean).join(" · ")}</div>
        </div>
      </div>

      {/* Points */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#ffd54a] via-brand to-brand-strong p-5 text-brand-ink shadow-[0_20px_40px_-20px_rgba(245,180,0,0.7)] animate-rise">
        <Sparkles className="absolute -right-3 -top-3 size-28 opacity-15" />
        <div className="text-sm font-semibold opacity-80">{t.myPoints}</div>
        {l ? (
          <>
            <div className="mt-1 text-5xl font-extrabold tracking-tight tabular-nums">
              {l.balance}
              <span className="ml-2 text-lg font-semibold opacity-70">{t.points}</span>
            </div>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-brand-ink transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 text-sm font-medium opacity-80">
              {l.balance >= l.pointsPerVoucher ? t.canRedeem : t.toNextVoucher(l.pointsPerVoucher - l.balance)}
            </div>
            <Button
              variant="dark"
              block
              className="mt-4"
              disabled={l.balance < l.pointsPerVoucher}
              loading={redeem.isPending}
              onClick={async () => {
                if (await confirmDialog(t.redeemConfirm(l.pointsPerVoucher, l.voucherPercent))) redeem.mutate();
              }}
            >
              <Gift className="size-5" /> {t.redeem(l.pointsPerVoucher, l.voucherPercent)}
            </Button>
            <div className="mt-3 text-center text-xs font-medium opacity-70">{t.perTrip(l.pointsPerTrip)}</div>
          </>
        ) : (
          <Skeleton className="mt-2 h-24 bg-black/10" />
        )}
      </div>

      {/* Vouchers */}
      <SectionTitle>{t.vouchers}</SectionTitle>
      {l && l.vouchers.length === 0 && <Card className="text-center text-sm text-muted">{t.noVouchers}</Card>}
      <div className="space-y-2.5">
        {l?.vouchers.map((v) => (
          <div
            key={v.id}
            className={cx(
              "relative flex items-center gap-4 overflow-hidden rounded-2xl border border-dashed p-4",
              v.status === "ACTIVE" ? "border-brand bg-brand/10" : "border-line bg-surface opacity-60",
            )}
          >
            <span className="absolute -left-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-bg" />
            <span className="absolute -right-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-bg" />
            <Ticket className="size-7 shrink-0 text-brand-strong" />
            <div className="flex-1">
              <div className="text-xl font-extrabold">-{v.percent}%</div>
              <div className="text-xs text-muted">{ddmmyyyy(v.createdAt)}</div>
            </div>
            <span className={cx("rounded-full px-2.5 py-1 text-xs font-bold", v.status === "ACTIVE" ? "bg-ok/15 text-ok" : "bg-surface-2 text-muted")}>
              {v.status === "ACTIVE" ? t.voucherActive : t.voucherUsed}
            </span>
          </div>
        ))}
      </div>
      {l && l.vouchers.some((v) => v.status === "ACTIVE") && <div className="mt-2 px-1 text-xs text-muted">{t.voucherHint}</div>}

      {/* Referral */}
      <SectionTitle>{t.invite}</SectionTitle>
      {l && (
        <Card>
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-info/12 text-info">
              <UserPlus className="size-5" />
            </span>
            <div>
              <div className="font-semibold">{t.inviteHint(l.referralBonus)}</div>
              <div className="text-sm text-muted">{t.invited(l.referralsCount)}</div>
            </div>
          </div>
          <div className="mt-3 truncate rounded-xl bg-surface-2 px-3 py-2.5 font-mono text-[13px]">{l.referralLink}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={async () => {
                await navigator.clipboard?.writeText(l.referralLink).catch(() => undefined);
                toast.ok(t.copied);
              }}
            >
              <Copy className="size-4" /> {t.copy}
            </Button>
            <Button
              size="md"
              onClick={() =>
                openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(l.referralLink)}&text=${encodeURIComponent(t.shareText)}`)
              }
            >
              <Send className="size-4" /> {t.share}
            </Button>
          </div>
        </Card>
      )}

      {/* Favorites */}
      {(favorites.data?.length ?? 0) > 0 && (
        <>
          <SectionTitle>{t.favorites}</SectionTitle>
          <Card className="divide-y divide-line/60 p-0">
            {favorites.data!.map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-3">
                <Star className="size-5 shrink-0 fill-brand text-brand-strong" />
                <button className="min-w-0 flex-1 text-left" onClick={() => push({ name: "order-form", routeId: f.route.id, prefill: { pickup: f.pickup, dropoff: f.dropoff } })}>
                  <div className="truncate font-semibold">
                    {city(f.route.fromCity)} → {city(f.route.toCity)}
                  </div>
                  <div className="truncate text-sm text-muted">{[f.pickup, f.dropoff].filter(Boolean).join(" → ")}</div>
                </button>
                <button aria-label="delete" onClick={() => removeFav.mutate(f.id)} className="grid size-9 place-items-center rounded-xl text-muted active:bg-surface-2">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </Card>
        </>
      )}

      {/* Points history */}
      {l && l.ledger.length > 0 && (
        <>
          <SectionTitle>{t.history}</SectionTitle>
          <Card className="divide-y divide-line/60 p-0">
            {l.ledger.slice(0, 10).map((e) => (
              <div key={e.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="font-medium">{t.ledger[e.type] ?? e.type}</div>
                  <div className="text-xs text-muted">{ddmmyyyy(e.createdAt)}</div>
                </div>
                <div className={cx("font-bold tabular-nums", e.amount > 0 ? "text-ok" : "text-bad")}>
                  {e.amount > 0 ? "+" : ""}
                  {e.amount}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      {/* Settings */}
      <SectionTitle>
        <span className="inline-flex items-center gap-2">
          <Languages className="size-4" /> {t.language}
        </span>
      </SectionTitle>
      <Segmented<Language>
        value={lang}
        onChange={(v) => void setLanguage(v)}
        options={[
          { value: "UZ_LATN", label: "O'zbekcha" },
          { value: "UZ_CYRL", label: "Ўзбекча" },
        ]}
      />

      {(me.isDriver || me.isAdmin) && (
        <div className="mt-6 space-y-3">
          {me.isDriver && (
            <Button variant="dark" block onClick={() => setMode("driver")}>
              <Car className="size-5" /> {t.driverMode}
            </Button>
          )}
          {me.isAdmin && (
            <Button variant="secondary" block onClick={() => window.location.assign(`${API_URL.replace(/\/$/, "")}/admin/`)}>
              <Shield className="size-5" /> {t.adminPanel}
            </Button>
          )}
        </div>
      )}
    </Page>
  );
}
