import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Car, ClipboardList, Gift, LayoutDashboard, LogOut, MessagesSquare, Send, Settings as Cog, Users as UsersIcon } from "lucide-react";
import type { MeDto } from "@taxi/shared";
import { ApiError, colorScheme, tg } from "@taxi/web-core";
import { Btn, api, cx, queryClient, registerToast, session } from "./core";
import { Dashboard } from "./pages/Dashboard";
import { Orders } from "./pages/Orders";
import { Drivers, Users } from "./pages/People";
import { Groups, Loyalty, SettingsPage } from "./pages/System";
import "./index.css";

type PageKey = "dashboard" | "orders" | "drivers" | "users" | "groups" | "loyalty" | "settings";
const NAV: { key: PageKey; label: string; icon: ReactNode }[] = [
  { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-5" /> },
  { key: "orders", label: "Buyurtmalar", icon: <ClipboardList className="size-5" /> },
  { key: "drivers", label: "Haydovchilar", icon: <Car className="size-5" /> },
  { key: "users", label: "Mijozlar", icon: <UsersIcon className="size-5" /> },
  { key: "groups", label: "Guruhlar", icon: <MessagesSquare className="size-5" /> },
  { key: "loyalty", label: "Loyalty", icon: <Gift className="size-5" /> },
  { key: "settings", label: "Sozlamalar", icon: <Cog className="size-5" /> },
];

const PAGE_KEY = "taxi-admin-page";
function savedPage(): PageKey {
  try {
    const p = localStorage.getItem(PAGE_KEY) as PageKey | null;
    return p && NAV.some((n) => n.key === p) ? p : "dashboard";
  } catch {
    return "dashboard";
  }
}

function Layout({ me }: { me: MeDto }) {
  const [page, setPage] = useState<PageKey>(savedPage);
  const go = (p: PageKey) => {
    setPage(p);
    window.scrollTo({ top: 0 });
    try {
      localStorage.setItem(PAGE_KEY, p);
    } catch {
      /* ignore */
    }
  };
  const inTelegram = Boolean(tg());

  return (
    <div className="min-h-dvh lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface p-4 lg:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <span className="grid size-10 place-items-center rounded-2xl bg-brand text-xl">🚕</span>
          <div>
            <div className="font-bold leading-tight">Farg'ona – Qo'qon</div>
            <div className="text-xs text-muted">Admin panel</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => go(n.key)}
              className={cx(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                page === n.key ? "bg-brand text-brand-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-surface-2 p-3">
          <span className="grid size-9 place-items-center rounded-full bg-ink text-sm font-bold text-bg">{(me.firstName ?? "A").slice(0, 1)}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{me.firstName}</div>
            <div className="truncate text-xs text-muted">{me.username ? `@${me.username}` : "admin"}</div>
          </div>
          {!inTelegram && (
            <button
              title="Chiqish"
              onClick={() => {
                session.clear();
                window.location.reload();
              }}
              className="text-muted hover:text-bad"
            >
              <LogOut className="size-4" />
            </button>
          )}
        </div>
      </aside>

      {/* Top nav (mobile / Telegram) */}
      <div className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur lg:hidden">
        <div className="flex gap-1 overflow-x-auto px-3 py-2">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => go(n.key)}
              className={cx(
                "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold",
                page === n.key ? "bg-brand text-brand-ink" : "text-muted",
              )}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
        </div>
      </div>

      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          {page === "dashboard" && <Dashboard onOpenOrders={() => go("orders")} />}
          {page === "orders" && <Orders />}
          {page === "drivers" && <Drivers />}
          {page === "users" && <Users />}
          {page === "groups" && <Groups />}
          {page === "loyalty" && <Loyalty />}
          {page === "settings" && <SettingsPage />}
        </div>
      </main>
    </div>
  );
}

function Login({ message }: { message?: string }) {
  const cfg = useQuery({ queryKey: ["public-config"], queryFn: () => api.get<{ botUsername: string }>("/public/config") });
  const link = cfg.data ? `https://t.me/${cfg.data.botUsername}?start=login` : null;
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-8 text-center shadow-xl animate-rise">
        <div className="mx-auto mb-5 grid size-16 place-items-center rounded-3xl bg-brand text-3xl">🚕</div>
        <h1 className="text-2xl font-bold">Admin panel</h1>
        <p className="mt-2 text-sm text-muted">Kirish faqat Telegram orqali. Bot sizga bir martalik havola yuboradi (5 daqiqa amal qiladi).</p>
        {message && <p className="mt-4 rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{message}</p>}
        <a
          href={link ?? "#"}
          target="_blank"
          rel="noreferrer"
          className={cx(
            "mt-6 flex h-12 items-center justify-center gap-2 rounded-2xl bg-info font-semibold text-white transition hover:opacity-90",
            !link && "pointer-events-none opacity-50",
          )}
        >
          <Send className="size-4" /> Telegram orqali kirish
        </a>
        <p className="mt-4 text-xs text-muted">Yoki botda /admin buyrug'ini yuboring.</p>
      </div>
    </div>
  );
}

function Boot() {
  const [ready, setReady] = useState(false);
  const [loginError, setLoginError] = useState<string | undefined>();

  // Browser login: ?login=<one-time token> from the bot -> session.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("login");
    if (!token || tg()) return setReady(true);
    window.history.replaceState(null, "", window.location.pathname);
    api
      .post<{ session: string }>("/auth/exchange", { token })
      .then((r) => session.set(r.session))
      .catch(() => setLoginError("Havola eskirgan yoki ishlatilgan. Yangisini oling."))
      .finally(() => setReady(true));
  }, []);

  const hasAuth = Boolean(tg()) || Boolean(session.get());
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get<MeDto>("/me"), enabled: ready && hasAuth, retry: false });

  if (!ready || (hasAuth && me.isLoading)) {
    return <div className="grid min-h-dvh place-items-center text-muted">Yuklanmoqda...</div>;
  }
  if (!hasAuth || me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) session.clear();
    return <Login message={loginError ?? (me.error ? "Sessiya tugagan. Qayta kiring." : undefined)} />;
  }
  if (me.data && !me.data.isAdmin) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <div className="mb-3 text-5xl">⛔</div>
          <div className="text-lg font-semibold">Sizda admin huquqi yo'q</div>
          {!tg() && (
            <Btn variant="secondary" className="mt-4" onClick={() => { session.clear(); window.location.reload(); }}>
              Chiqish
            </Btn>
          )}
        </div>
      </div>
    );
  }
  return me.data ? <Layout me={me.data} /> : null;
}

function Toasts() {
  const [items, setItems] = useState<{ id: number; text: string; ok: boolean }[]>([]);
  useEffect(() => {
    let id = 0;
    registerToast((text, ok) => {
      const item = { id: ++id, text, ok };
      setItems((s) => [...s, item]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== item.id)), 3000);
    });
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col items-end gap-2">
      {items.map((t) => (
        <div key={t.id} className={cx("animate-rise rounded-xl px-4 py-3 text-sm font-medium shadow-lg", t.ok ? "bg-ink text-bg" : "bg-bad text-white")}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

document.documentElement.dataset.theme = colorScheme();
const app = tg();
app?.ready();
app?.expand();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Boot />
      <Toasts />
    </QueryClientProvider>
  </StrictMode>,
);
