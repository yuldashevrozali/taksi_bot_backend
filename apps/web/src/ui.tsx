import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2, Minus, Plus } from "lucide-react";
import type { OrderStatus } from "@taxi/shared";
import { haptic } from "@taxi/web-core";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dark";

export function Button({
  variant = "primary",
  loading,
  block,
  size = "lg",
  className,
  children,
  onClick,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; block?: boolean; size?: "md" | "lg" }) {
  const styles: Record<Variant, string> = {
    primary: "bg-brand text-brand-ink shadow-[0_8px_24px_-8px_rgba(245,180,0,0.6)] active:bg-brand-strong",
    secondary: "bg-surface-2 text-ink active:opacity-80",
    ghost: "bg-transparent text-ink active:bg-surface-2",
    danger: "bg-bad/10 text-bad active:bg-bad/20",
    dark: "bg-ink text-bg active:opacity-90",
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      onClick={(e) => {
        haptic.tap();
        onClick?.(e);
      }}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-2xl font-semibold transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        size === "lg" ? "h-14 px-5 text-[16px]" : "h-11 px-4 text-[15px]",
        block && "w-full",
        styles[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-5 animate-spin" /> : children}
    </button>
  );
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cx(
        "rounded-3xl border border-line/60 bg-surface p-4",
        onClick && "cursor-pointer transition-transform active:scale-[0.99]",
        className,
      )}
    >
      {children}
    </div>
  );
}

const STATUS_STYLE: Record<OrderStatus, string> = {
  PENDING: "bg-warn/12 text-warn",
  ACCEPTED: "bg-info/12 text-info",
  IN_PROGRESS: "bg-brand/20 text-[#9a6b00] dark:text-brand",
  COMPLETED: "bg-ok/12 text-ok",
  CANCELLED: "bg-muted/15 text-muted",
};

export function StatusBadge({ status, label }: { status: OrderStatus; label: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_STYLE[status])}>
      <span className={cx("size-1.5 rounded-full bg-current", status === "PENDING" && "animate-pulse")} />
      {label}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid rounded-2xl bg-surface-2 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => {
            haptic.select();
            onChange(o.value);
          }}
          className={cx(
            "flex h-11 items-center justify-center gap-1.5 rounded-xl text-[15px] font-semibold transition-all",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  const set = (n: number) => {
    if (n < min || n > max) return;
    haptic.select();
    onChange(n);
  };
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label="-"
        onClick={() => set(value - 1)}
        disabled={value <= min}
        className="grid size-11 place-items-center rounded-2xl bg-surface-2 text-ink transition active:scale-95 disabled:opacity-40"
      >
        <Minus className="size-5" />
      </button>
      <div className="w-10 text-center text-2xl font-bold tabular-nums">{value}</div>
      <button
        type="button"
        aria-label="+"
        onClick={() => set(value + 1)}
        disabled={value >= max}
        className="grid size-11 place-items-center rounded-2xl bg-surface-2 text-ink transition active:scale-95 disabled:opacity-40"
      >
        <Plus className="size-5" />
      </button>
    </div>
  );
}

export function Field({
  label,
  icon,
  error,
  children,
}: {
  label?: string;
  icon?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block">
      {label && <div className="mb-1.5 px-1 text-[13px] font-medium text-muted">{label}</div>}
      <div
        className={cx(
          "flex items-center gap-3 rounded-2xl border bg-surface px-4 transition-colors focus-within:border-brand",
          error ? "border-bad" : "border-line",
        )}
      >
        {icon && <span className="shrink-0 text-muted">{icon}</span>}
        {children}
      </div>
      {error && <div className="mt-1 px-1 text-xs text-bad">{error}</div>}
    </label>
  );
}

export const inputClass = "h-13 w-full min-w-0 bg-transparent py-3.5 text-ink outline-none placeholder:text-muted/70";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-2xl", className)} />;
}

export function Empty({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center animate-rise">
      <div className="mb-4 grid size-16 place-items-center rounded-3xl bg-surface-2 text-muted">{icon}</div>
      <div className="text-[17px] font-semibold">{title}</div>
      {hint && <div className="mt-1 max-w-64 text-sm text-muted">{hint}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-[15px] font-semibold text-muted">{children}</h2>
      {right}
    </div>
  );
}

/** Vertical from → to line with dots, like ride-hailing apps. */
export function RouteLine({ from, to, fromSub, toSub, size = "md" }: { from: string; to: string; fromSub?: string | null; toSub?: string | null; size?: "md" | "lg" }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center pt-1.5">
        <span className="size-2.5 rounded-full border-2 border-ink" />
        <span className="my-1 w-px flex-1 border-l-2 border-dotted border-line" />
        <span className="size-2.5 rounded-full bg-brand ring-4 ring-brand/25" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="min-w-0">
          <div className={cx("font-semibold leading-tight", size === "lg" ? "text-lg" : "text-[15px]")}>{from}</div>
          {fromSub && <div className="truncate text-sm text-muted">{fromSub}</div>}
        </div>
        <div className="min-w-0">
          <div className={cx("font-semibold leading-tight", size === "lg" ? "text-lg" : "text-[15px]")}>{to}</div>
          {toSub && <div className="truncate text-sm text-muted">{toSub}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Toasts ──
type Toast = { id: number; text: string; kind: "ok" | "error" };
let pushToast: (t: Omit<Toast, "id">) => void = () => {};
export const toast = {
  ok: (text: string) => {
    haptic.success();
    pushToast({ text, kind: "ok" });
  },
  error: (text: string) => {
    haptic.error();
    pushToast({ text, kind: "error" });
  },
};

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let id = 0;
    pushToast = (t) => {
      const item = { ...t, id: ++id };
      setItems((s) => [...s, item]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== item.id)), 2800);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          className={cx(
            "animate-rise rounded-2xl px-4 py-3 text-sm font-medium shadow-lg backdrop-blur",
            t.kind === "ok" ? "bg-ink/90 text-bg" : "bg-bad text-white",
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
