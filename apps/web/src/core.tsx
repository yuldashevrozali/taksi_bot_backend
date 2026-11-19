import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { ApiError, createApi, tg, type Api } from "@taxi/web-core";
import type { Language, MeDto, OrderDto } from "@taxi/shared";
import { DICTS, city, type Dict } from "./i18n";

/** Backend origin. Empty when served by the backend itself (local dev / single server). */
export const API_URL: string = normalizeApiUrl(import.meta.env.VITE_API_URL as string | undefined);

/** Accepts "api.example.com", "https://api.example.com/" etc. A missing scheme would make fetch relative. */
function normalizeApiUrl(raw: string | undefined): string {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

export const api: Api = createApi(() => {
  const app = tg();
  return app ? `tma ${app.initData}` : null;
}, API_URL);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
      staleTime: 5_000,
    },
  },
});

// ── Routing: an in-memory stack (Telegram puts launch params in the URL hash, so we don't use it) ──
export type Prefill = Partial<Pick<OrderDto, "pickup" | "dropoff" | "passengers" | "comment">> & { routeId?: string };
export type Route =
  | { name: "home" }
  | { name: "orders" }
  | { name: "profile" }
  | { name: "order-form"; routeId: string; prefill?: Prefill }
  | { name: "order"; id: string }
  | { name: "d-order"; id: string }
  | { name: "d-new" }
  | { name: "d-mine" }
  | { name: "d-history" }
  | { name: "d-voucher" };

export type Mode = "client" | "driver";

interface Ctx {
  me: MeDto;
  lang: Language;
  t: Dict;
  city: (name: string) => string;
  route: Route;
  push: (r: Route) => void;
  back: () => void;
  reset: (r: Route) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  setLanguage: (l: Language) => Promise<void>;
  errorText: (e: unknown) => string;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

export function AppProvider({ me, initial, children }: { me: MeDto; initial: Route; children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([initial]);
  const [lang, setLang] = useState<Language>(me.language);
  const [mode, setModeState] = useState<Mode>(initial.name.startsWith("d-") ? "driver" : "client");
  const route = stack[stack.length - 1]!;

  const push = useCallback((r: Route) => {
    setStack((s) => [...s, r]);
    window.scrollTo({ top: 0 });
  }, []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((r: Route) => {
    setStack([r]);
    window.scrollTo({ top: 0 });
  }, []);
  const setMode = useCallback(
    (m: Mode) => {
      setModeState(m);
      reset(m === "driver" ? { name: "d-new" } : { name: "home" });
    },
    [reset],
  );

  // Telegram native Back button mirrors our stack.
  useEffect(() => {
    const app = tg();
    if (!app) return;
    if (stack.length > 1) {
      app.BackButton.show();
      app.BackButton.onClick(back);
      return () => app.BackButton.offClick(back);
    }
    app.BackButton.hide();
  }, [stack.length, back]);

  const t = DICTS[lang];
  const value = useMemo<Ctx>(
    () => ({
      me,
      lang,
      t,
      city: (n) => city(n, lang),
      route,
      push,
      back,
      reset,
      mode,
      setMode,
      setLanguage: async (l) => {
        setLang(l);
        await api.patch("/me", { language: l });
      },
      errorText: (e) => (e instanceof ApiError ? (t.errors[e.code] ?? t.genericError) : t.genericError),
    }),
    [me, lang, t, route, push, back, reset, mode, setMode],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// ── Shared queries ──
export const useOrders = () => useQuery({ queryKey: ["orders"], queryFn: () => api.get<OrderDto[]>("/orders"), refetchInterval: 10_000 });

export function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}
