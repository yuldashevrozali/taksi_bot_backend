// `npm run dev`: builds the frontends, opens an HTTPS tunnel, then runs the API (auto-reload)
// and rebuilds the frontends on change. The API registers the Telegram webhook on startup.
import "dotenv/config";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { startReachableTunnel, writePublicUrlToEnv } from "./tunnel.js";

const port = Number(process.env.API_PORT ?? 3000);
const children: ChildProcess[] = [];

console.log("Building Mini App and admin panel...");
for (const ws of ["@taxi/web", "@taxi/admin"]) {
  const r = spawnSync("npm", ["run", "build", "-w", ws], { stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) {
    console.error(`Build failed: ${ws}`);
    process.exit(1);
  }
}

console.log("Starting HTTPS tunnel...");
const tunnel = await startReachableTunnel(port);
writePublicUrlToEnv(tunnel.url);
console.log(`Tunnel: ${tunnel.url} -> http://localhost:${port}`);

const env = { ...process.env, PUBLIC_BASE_URL: tunnel.url, API_PORT: String(port) };
const api = spawn("npm", ["run", "dev", "-w", "@taxi/api"], { stdio: "inherit", env });
children.push(api);
for (const ws of ["@taxi/web", "@taxi/admin"]) {
  // Rebuild on change (quiet; errors still shown).
  children.push(spawn("npm", ["run", "watch", "-w", ws, "--", "--logLevel", "error"], { stdio: ["ignore", "ignore", "inherit"] }));
}

let stopping = false;
const stopAll = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  tunnel.stop();
  setTimeout(() => process.exit(code), 500);
};
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => stopAll(0));
api.on("exit", (code) => stopAll(code ?? 0));
tunnel.child.on("exit", () => {
  console.error("Tunnel closed unexpectedly.");
  stopAll(1);
});
