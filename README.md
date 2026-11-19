# Farg'ona – Qo'qon Taksi · Backend

Telegram orqali taksi buyurtma platformasi: Farg'ona ↔ Qo'qon. Bitta xizmat ichida:

- **API** (Fastify + TypeScript) — buyurtmalar, haydovchilar, loyalty, admin
- **Telegram bot** (grammY, webhook) — mijoz menyusi, haydovchilar guruhi, ommaviy guruhlardan buyurtma aniqlash
- **Admin panel** (React) — `/admin/`
- **Mini App** (React) — `/app/` (zaxira; asosiy nusxa Vercel'da: [Taksi-bot-app](https://github.com/yuldashevrozali/Taksi-bot-app))
- **MongoDB Atlas** (Prisma)

## Tuzilishi

```
apps/api        API, servislar, scheduler (15 daqiqalik eslatma)
apps/bot        bot handlerlari, matnlar (lotin / kirill)
apps/web        Mini App (mijoz + haydovchi)
apps/admin      Admin panel
packages/shared umumiy tiplar, Zod validatsiya
prisma/         schema, indekslar, seed
scripts/        dev (tunnel), Mini App eksporti
```

## Railway'ga joylash

1. Railway → **New Project → Deploy from GitHub repo** → shu repo. `Dockerfile` va `railway.json` avtomatik ishlatiladi.
2. **Settings → Networking → Generate Domain** (masalan `taksi.up.railway.app`).
3. **Variables** (pastdagi jadval) → saqlang → deploy.
4. MongoDB Atlas → **Network Access** → `0.0.0.0/0` ga ruxsat bering (Railway IP manzillari o'zgaruvchan).
5. Loglarda `Webhook set: https://.../telegram/webhook` chiqishi kerak.
6. Vercel'dagi Mini App: `VITE_API_URL` = Railway domeni → **Redeploy**.

### O'zgaruvchilar

| O'zgaruvchi | Majburiy | Izoh |
|---|---|---|
| `DATABASE_URL` | ✅ | MongoDB Atlas, `mongodb+srv://.../taxi?retryWrites=true&w=majority` |
| `BOT_TOKEN` | ✅ | @BotFather |
| `BOT_WEBHOOK_SECRET` | ✅ | tasodifiy 16–256 belgi `[A-Za-z0-9_-]` |
| `SESSION_SECRET` | ✅ | tasodifiy 32+ belgi (admin brauzer sessiyalari) |
| `ADMIN_TELEGRAM_IDS` | ✅ | vergul bilan, masalan `123,456` |
| `DRIVERS_GROUP_CHAT_ID` | ✅ | haydovchilar guruhi (`-100...`) |
| `MINI_APP_URL` | — | Vercel manzili; bot tugmalari shuni ochadi, CORS ruxsati |
| `MINI_APP_SHORT_NAME` | — | @BotFather Mini App qisqa nomi (guruhdan bir bosishda ochish) |
| `PUBLIC_BASE_URL` | — | Railway'da avtomatik: `https://$RAILWAY_PUBLIC_DOMAIN` |
| `API_PORT` | — | Railway'da avtomatik: `$PORT` |

Tasodifiy kalit yaratish: `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`

> ⚠️ Lokal `npm run dev` webhook'ni tunnelga o'tkazib yuboradi. Production ishlayotganda lokal dev uchun **alohida test bot** ishlating.

## Lokal ishlab chiqish

```bash
npm install
cp .env.example .env      # qiymatlarni to'ldiring
npm run db:setup && npm run db:seed
npm run dev               # frontend build + Cloudflare tunnel + API + webhook
npm test                  # testlar (vaqtinchalik MongoDB, Telegram'ga hech narsa yubormaydi)
```
