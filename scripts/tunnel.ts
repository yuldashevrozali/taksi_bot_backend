// Dev only: exposes a local port over HTTPS via a Cloudflare quick tunnel (no account needed).
// The URL changes on every run. Standalone usage: `npm run tunnel` (writes PUBLIC_BASE_URL to .env).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_PATH = path.join(root, ".env");

export function setEnvVar(content: string, key: string, value: string): string {
  const line = `${key}="${value}"`;
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(content) ? content.replace(re, line) : `${content.replace(/\n?$/, "\n")}${line}\n`;
}

export function writePublicUrlToEnv(url: string): void {
  const current = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  writeFileSync(ENV_PATH, setEnvVar(current, "PUBLIC_BASE_URL", url), { mode: 0o600 });
}

export interface Tunnel {
  url: string;
  child: ChildProcess;
  stop(): void;
}

export function startTunnel(port: number, timeoutMs = 60_000): Promise<Tunnel> {
  return new Promise((resolve, reject) => {
    const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stop = () => {
      if (child.exitCode === null) child.kill("SIGTERM");
    };
    // Never leave cloudflared running after this process stops.
    process.on("exit", stop);

    const timer = setTimeout(() => {
      stop();
      reject(new Error("cloudflared did not report a URL in time"));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared failed to start (brew install cloudflared): ${e.message}`));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared exited with code ${code}`));
    });
    // Resolve only when we have the URL AND the tunnel is actually connected to Cloudflare.
    let url: string | null = null;
    let registered = false;
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      url ??= /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)?.[0] ?? null;
      if (text.includes("Registered tunnel connection")) registered = true;
      if (!url || !registered) return;
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.stdout?.resume();
      child.stderr?.resume();
      resolve({ url, child, stop });
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
  });
}

/** Waits until the tunnel hostname resolves in public DNS (what Telegram's servers will use). */
export async function waitForPublicDns(url: string, timeoutMs = 60_000): Promise<boolean> {
  const host = new URL(url).hostname;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(5000),
      });
      const body = (await res.json()) as { Status: number; Answer?: unknown[] };
      if (body.Status === 0 && body.Answer?.length) return true;
    } catch {
      // network hiccup — retry
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/** Starts a tunnel whose hostname is publicly resolvable; replaces "dead" quick tunnels. */
export async function startReachableTunnel(port: number, attempts = 3): Promise<Tunnel> {
  for (let i = 1; i <= attempts; i++) {
    const tunnel = await startTunnel(port);
    console.log(`Tunnel ${tunnel.url} connected, waiting for public DNS...`);
    if (await waitForPublicDns(tunnel.url)) return tunnel;
    console.warn(`Tunnel hostname did not appear in DNS (attempt ${i}/${attempts}), opening a new one...`);
    tunnel.stop();
  }
  throw new Error("Could not get a reachable Cloudflare quick tunnel. Check your internet connection and retry.");
}

// Standalone mode.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.API_PORT ?? 3000);
  const tunnel = await startReachableTunnel(port);
  writePublicUrlToEnv(tunnel.url);
  console.log(`Tunnel ready: ${tunnel.url} -> http://localhost:${port}`);
  console.log("PUBLIC_BASE_URL updated in .env (restart the API to pick it up).");
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => process.exit(0));
  tunnel.child.on("exit", (code) => process.exit(code ?? 0));
}
