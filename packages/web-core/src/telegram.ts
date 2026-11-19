// Minimal typing for https://telegram.org/js/telegram-web-app.js (loaded in index.html).
export interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string }; start_param?: string };
  colorScheme: "light" | "dark";
  platform: string;
  version: string;
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(v: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  disableVerticalSwipes?(): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export function tg(): TgWebApp | null {
  const app = window.Telegram?.WebApp;
  return app && app.initData ? app : null;
}

export const haptic = {
  tap: () => tg()?.HapticFeedback?.impactOccurred("light"),
  success: () => tg()?.HapticFeedback?.notificationOccurred("success"),
  error: () => tg()?.HapticFeedback?.notificationOccurred("error"),
  select: () => tg()?.HapticFeedback?.selectionChanged(),
};

export function confirmDialog(message: string): Promise<boolean> {
  const app = tg();
  if (app?.showConfirm && app.isVersionAtLeast("6.2")) {
    return new Promise((resolve) => app.showConfirm!(message, resolve));
  }
  return Promise.resolve(window.confirm(message));
}

export function openTelegramLink(url: string): void {
  const app = tg();
  if (app && url.startsWith("https://t.me/")) app.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

/** Dark/light from Telegram, falling back to the OS preference. */
export function colorScheme(): "light" | "dark" {
  const app = window.Telegram?.WebApp;
  if (app?.colorScheme) return app.colorScheme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
