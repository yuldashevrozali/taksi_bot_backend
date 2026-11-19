import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import type { MeDto, OrderDto } from "@taxi/shared";
import { ApiError, colorScheme, tg } from "@taxi/web-core";
import { AppProvider, api, queryClient, useApp, type Route } from "./core";
import { BottomNav } from "./components";
import { DICTS } from "./i18n";
import { Home } from "./pages/Home";
import { OrderForm } from "./pages/OrderForm";
import { OrderStatus } from "./pages/OrderStatus";
import { Orders, Profile } from "./pages/Profile";
import { DriverHistory, DriverMine, DriverNew, DriverOrder, DriverVoucher } from "./pages/Driver";
import { Button, Skeleton, Toaster, toast } from "./ui";
import "./index.css";

function applyTheme(): void {
  const scheme = colorScheme();
  document.documentElement.dataset.theme = scheme;
  const bg = scheme === "dark" ? "#0f1115" : "#f4f5f7";
  const app = tg();
  if (app?.isVersionAtLeast("6.1")) {
    app.setHeaderColor?.(bg);
    app.setBackgroundColor?.(bg);
  }
}

function Screen() {
  const { route } = useApp();
  switch (route.name) {
    case "home":
      return <Home />;
    case "orders":
      return <Orders />;
    case "profile":
      return <Profile />;
    case "order-form":
      return <OrderForm key={route.routeId + JSON.stringify(route.prefill ?? {})} routeId={route.routeId} prefill={route.prefill} />;
    case "order":
      return <OrderStatus id={route.id} />;
    case "d-order":
      return <DriverOrder id={route.id} />;
    case "d-new":
      return <DriverNew />;
    case "d-mine":
      return <DriverMine />;
    case "d-history":
      return <DriverHistory />;
    case "d-voucher":
      return <DriverVoucher />;
  }
}

function Shell() {
  const { route } = useApp();
  const tabRoutes = ["home", "orders", "profile", "d-order", "d-new", "d-mine", "d-history", "d-voucher"];
  return (
    <>
      <Screen />
      {tabRoutes.includes(route.name) && <BottomNav />}
    </>
  );
}

/**
 * Decides the first screen from launch params: ?order=<id> (or startapp=order_<id> from a Mini App
 * direct link) for drivers, ?mode=driver, ?repeat=<orderId>.
 */
async function initialRoute(me: MeDto): Promise<Route> {
  const params = new URLSearchParams(window.location.search);
  const startParam = tg()?.initDataUnsafe.start_param ?? "";
  const orderId = params.get("order") ?? (startParam.startsWith("order_") ? startParam.slice(6) : null);
  if (orderId && /^[a-f0-9]{24}$/.test(orderId)) {
    if (me.isDriver) return { name: "d-order", id: orderId };
    toast.error(DICTS[me.language].notDriver);
  }
  if (params.get("mode") === "driver" && me.isDriver) return { name: "d-new" };
  const repeat = params.get("repeat");
  if (repeat && /^[a-f0-9]{24}$/.test(repeat)) {
    try {
      const o = await api.get<OrderDto>(`/orders/${repeat}`);
      return {
        name: "order-form",
        routeId: o.route.id,
        prefill: { pickup: o.pickup, dropoff: o.dropoff, passengers: o.passengersUnknown ? 1 : o.passengers, comment: o.comment },
      };
    } catch {
      /* fall through */
    }
  }
  return { name: "home" };
}

function Boot() {
  const inTelegram = Boolean(tg());
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get<MeDto>("/me"), enabled: inTelegram, retry: 1 });
  const [initial, setInitial] = useState<Route | null>(null);

  useEffect(() => {
    if (me.data) void initialRoute(me.data).then(setInitial);
  }, [me.data]);

  const t = DICTS[me.data?.language ?? "UZ_LATN"];

  if (!inTelegram) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <div className="mb-5 grid size-20 place-items-center rounded-3xl bg-brand text-4xl">🚕</div>
        <h1 className="mb-2 text-2xl font-bold">{t.appName}</h1>
        <p className="mb-1 font-semibold">{t.openInTelegram}</p>
        <p className="max-w-80 text-sm text-muted">{t.openViaButton}</p>
        <Smartphone className="mt-6 size-8 text-muted" />
      </div>
    );
  }
  if (me.error) {
    const code = me.error instanceof ApiError ? me.error.code : "";
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="text-5xl">⚠️</div>
        <div className="text-lg font-semibold">{t.errors[code] ?? t.genericError}</div>
        <Button size="md" onClick={() => void me.refetch()}>
          {t.retry}
        </Button>
      </div>
    );
  }
  if (!me.data || !initial) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 pt-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  return (
    <AppProvider me={me.data} initial={initial}>
      <Shell />
    </AppProvider>
  );
}

const app = tg();
app?.ready();
app?.expand();
if (app?.isVersionAtLeast("7.7")) app.disableVerticalSwipes?.();
applyTheme();
window.Telegram?.WebApp?.onEvent("themeChanged", applyTheme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Boot />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
