// Builds a standalone, Vercel-ready copy of the Mini App (apps/web + packages/shared + packages/web-core)
// into exports/taxi-miniapp. The monorepo stays the source of truth: re-run this after changes, then push.
// Usage: npm run export:miniapp
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "exports/taxi-miniapp");

const version = (pkg: string): string => {
  const json = JSON.parse(readFileSync(path.join(root, "node_modules", pkg, "package.json"), "utf8")) as { version: string };
  return `^${json.version}`;
};

// Clean everything except the export repo's git history, lockfile and installed deps.
const KEEP = new Set([".git", "package-lock.json", "node_modules"]);
mkdirSync(out, { recursive: true });
for (const entry of readdirSync(out)) if (!KEEP.has(entry)) rmSync(path.join(out, entry), { recursive: true, force: true });

const copy = (from: string, to: string, filter?: (src: string) => boolean) =>
  cpSync(path.join(root, from), path.join(out, to), { recursive: true, ...(filter ? { filter } : {}) });

copy("apps/web/index.html", "index.html");
copy("apps/web/src", "src");
copy("packages/shared/src", "src/lib/shared");
copy("packages/web-core/src", "src/lib/web-core");

const write = (file: string, content: string) => writeFileSync(path.join(out, file), content.trimStart());

write(
  "package.json",
  JSON.stringify(
    {
      name: "taxi-miniapp",
      private: true,
      version: "1.0.0",
      type: "module",
      description: "Farg'ona – Qo'qon taksi: Telegram Mini App (mijoz va haydovchi)",
      scripts: { dev: "vite", build: "tsc --noEmit && vite build", preview: "vite preview" },
      dependencies: {
        "@tanstack/react-query": version("@tanstack/react-query"),
        "lucide-react": version("lucide-react"),
        react: version("react"),
        "react-dom": version("react-dom"),
        zod: version("zod"),
      },
      devDependencies: {
        "@tailwindcss/vite": version("@tailwindcss/vite"),
        "@types/node": version("@types/node"),
        "@types/react": version("@types/react"),
        "@types/react-dom": version("@types/react-dom"),
        "@vitejs/plugin-react": version("@vitejs/plugin-react"),
        tailwindcss: version("tailwindcss"),
        typescript: version("typescript"),
        vite: version("vite"),
      },
    },
    null,
    2,
  ) + "\n",
);

write(
  "vite.config.ts",
  `
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@taxi/shared": fileURLToPath(new URL("./src/lib/shared/index.ts", import.meta.url)),
      "@taxi/web-core": fileURLToPath(new URL("./src/lib/web-core/index.ts", import.meta.url)),
    },
  },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});
`,
);

write(
  "tsconfig.json",
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2023",
        lib: ["ES2023", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        noUncheckedIndexedAccess: true,
        isolatedModules: true,
        skipLibCheck: true,
        noEmit: true,
        types: ["vite/client"],
        paths: {
          "@taxi/shared": ["./src/lib/shared/index.ts"],
          "@taxi/web-core": ["./src/lib/web-core/index.ts"],
        },
      },
      include: ["src", "vite.config.ts"],
    },
    null,
    2,
  ) + "\n",
);

write(
  "vercel.json",
  JSON.stringify(
    {
      $schema: "https://openapi.vercel.sh/vercel.json",
      framework: "vite",
      buildCommand: "npm run build",
      outputDirectory: "dist",
      rewrites: [{ source: "/(.*)", destination: "/index.html" }],
      headers: [
        { source: "/index.html", headers: [{ key: "Cache-Control", value: "no-cache" }] },
        { source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      ],
    },
    null,
    2,
  ) + "\n",
);

write(
  ".env.example",
  `
# Backend (Railway) manzili. Masalan: https://taxi-api.up.railway.app
VITE_API_URL=
`,
);

write(
  ".gitignore",
  `
node_modules/
dist/
.env
.env.*
!.env.example
.DS_Store
.vercel
`,
);

write(
  "README.md",
  `
# Farg'ona – Qo'qon Taksi · Telegram Mini App

Mijoz va haydovchi uchun Telegram Mini App (React + TypeScript + Tailwind CSS).

- **Mijoz:** yo'nalish tanlash, buyurtma berish (yo'lovchilar soni, vaqt yoki "Hozir"), buyurtma holati, ballar, voucherlar, referral havola, sevimli yo'nalishlar.
- **Haydovchi:** yangi buyurtmalar, "Buyurtmani olish", mening buyurtmalarim (mijoz kontakti), tarix, voucher tekshirish.
- Interfeys: o'zbek tili (lotin va kirill), Telegram'ning yorug' / qorong'i mavzusiga moslashadi.

> Bu faqat frontend. Backend (API + Telegram bot) alohida joylashadi (Railway).
> Ilova faqat Telegram ichida ishlaydi: kirish Telegram \`initData\` orqali, imzosi backendda tekshiriladi.

## Sozlash

| O'zgaruvchi | Ma'nosi |
|---|---|
| \`VITE_API_URL\` | Backend manzili, masalan \`https://taxi-api.up.railway.app\` |

## Lokal ishga tushirish

\`\`\`bash
npm install
cp .env.example .env   # VITE_API_URL ni yozing
npm run dev
\`\`\`

## Vercel'ga joylash

1. Vercel → **Add New → Project** → shu GitHub repozitoriyni tanlang (framework: Vite, avtomatik aniqlanadi).
2. **Environment Variables:** \`VITE_API_URL\` = backend manzili.
3. **Deploy.** Natija: \`https://<loyiha>.vercel.app\`.
4. Backend \`.env\` ga shu manzilni yozing: \`MINI_APP_URL="https://<loyiha>.vercel.app"\`
   (bot tugmalari shu manzilni ochadi va backend shu manzildan so'rovlarga ruxsat beradi).

## Ishga tushirish parametrlari

| URL | Nima ochiladi |
|---|---|
| \`/\` | Mijoz bosh sahifasi |
| \`/?mode=driver\` | Haydovchi paneli |
| \`/?order=<id>\` | Haydovchi uchun bitta buyurtma ("Buyurtmani olish") |
| \`/?repeat=<id>\` | Eski buyurtma ma'lumotlari bilan yangi buyurtma formasi |

Telegram Mini App \`startapp=order_<id>\` parametri ham qo'llab-quvvatlanadi.

## Tuzilishi

\`\`\`
src/
  main.tsx, core.tsx       ilova, router (Telegram Back tugmasi bilan), kontekst
  pages/                   Home, OrderForm, OrderStatus, Profile, Driver
  ui.tsx, components.tsx   UI komponentlar
  i18n.ts                  lotin va kirill matnlari
  lib/shared/              umumiy tiplar va validatsiya (backend bilan bir xil)
  lib/web-core/            API klient, Telegram SDK, formatlash
\`\`\`
`,
);

// Safety: never ship secrets.
const leaks: string[] = [];
const scan = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scan(p);
    else if (/BOT_TOKEN=.+\d|mongodb\+srv:\/\/[^<]|SESSION_SECRET=\S{10}/.test(readFileSync(p, "utf8"))) leaks.push(p);
  }
};
scan(out);
if (leaks.length) {
  console.error("Possible secrets found, aborting:", leaks);
  process.exit(1);
}
if (existsSync(path.join(out, "src/lib/shared/index.ts"))) console.log(`Exported Mini App to ${path.relative(root, out)}`);
