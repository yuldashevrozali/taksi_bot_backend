import type { ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { OrderSource, OrderStatus } from "@taxi/shared";
import { ApiError, createApi, tg } from "@taxi/web-core";

const SESSION_KEY = "taxi-admin-session";

export const session = {
  get(): string | null {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  },
  set(v: string): void {
    try {
      localStorage.setItem(SESSION_KEY, v);
    } catch {
      /* private mode: session lasts for this page only */
    }
    memorySession = v;
  },
  clear(): void {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    memorySession = null;
  },
};
let memorySession: string | null = null;

/** Inside Telegram: initData. In a browser: the session obtained via the bot's one-time link. */
export const api = createApi(() => {
  const app = tg();
  if (app) return `tma ${app.initData}`;
  const s = memorySession ?? session.get();
  return s ? `Bearer ${s}` : null;
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      staleTime: 5_000,
    },
  },
});

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Kutilmoqda",
  ACCEPTED: "Qabul qilindi",
  IN_PROGRESS: "Yo'lda",
  COMPLETED: "Yakunlandi",
  CANCELLED: "Bekor qilindi",
};
export const SOURCE_LABEL: Record<OrderSource, string> = { BOT: "Bot", MINIAPP: "Mini App", WEB: "Web", GROUP: "Guruh" };

const STATUS_STYLE: Record<OrderStatus, string> = {
  PENDING: "bg-warn/12 text-warn",
  ACCEPTED: "bg-info/12 text-info",
  IN_PROGRESS: "bg-brand/20 text-[#9a6b00] dark:text-brand",
  COMPLETED: "bg-ok/12 text-ok",
  CANCELLED: "bg-muted/15 text-muted",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_STYLE[status])}>
      <span className={cx("size-1.5 rounded-full bg-current", status === "PENDING" && "animate-pulse")} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Btn({
  children,
  variant = "primary",
  loading,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; loading?: boolean }) {
  const styles = {
    primary: "bg-brand text-brand-ink hover:bg-brand-strong",
    secondary: "bg-surface-2 text-ink hover:bg-line",
    danger: "bg-bad/10 text-bad hover:bg-bad/20",
    ghost: "text-muted hover:bg-surface-2 hover:text-ink",
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50",
        styles[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Panel({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-2xl border border-line bg-surface", className)}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h3 className="font-semibold">{title}</h3>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export const inputCls =
  "h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none transition focus:border-brand placeholder:text-muted/70";

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="!py-12 text-center text-muted">
        {text}
      </td>
    </tr>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
      <span>
        Jami: <b className="text-ink">{total}</b>
      </span>
      <div className="flex items-center gap-2">
        <Btn variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ←
        </Btn>
        <span className="tabular-nums">
          {page} / {pages}
        </span>
        <Btn variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          →
        </Btn>
      </div>
    </div>
  );
}

const ERRORS: Record<string, string> = {
  user_must_start_bot: "Bu odam avval botga /start bosishi kerak",
  invalid_input: "Ma'lumotlar noto'g'ri",
  driver_required: "Bu holat uchun haydovchi kerak",
  cannot_remove_self: "O'zingizni o'chira olmaysiz",
  admin_from_env: "Bu admin .env faylida belgilangan",
  conflict_try_again: "Holat o'zgargan, sahifani yangilang",
  forbidden: "Ruxsat yo'q",
  network_error: "Internet aloqasi yo'q",
};
export function errorText(e: unknown): string {
  return e instanceof ApiError ? (ERRORS[e.code] ?? e.code) : "Xatolik";
}

// Minimal toast
let pushToastFn: ((text: string, ok: boolean) => void) | null = null;
export const toast = {
  ok: (t: string) => pushToastFn?.(t, true),
  error: (t: string) => pushToastFn?.(t, false),
};
export function registerToast(fn: (text: string, ok: boolean) => void): void {
  pushToastFn = fn;
}
