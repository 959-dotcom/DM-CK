# Spinlytics Domain Checker

Thai ISP domain monitoring SaaS — AIS / TRUE / DTAC / 3BB / NT status, PromptPay billing, Telegram alerts.

Built for Cursor **publish-app** (declared Postgres via `cursor-app.json` + `migrations/`). No GitHub remote required to run locally.

## Stack

- Next.js (App Router) + Tailwind + Lucide
- Postgres via `pg` when `DATABASE_URL` is set; **PGlite** in-memory fallback locally
- Prisma schema kept in sync at `prisma/schema.prisma` (runtime uses SQL + `src/lib/db.ts`)
- BullMQ + Redis when `REDIS_URL` is set; otherwise in-process scheduler
- PromptPay QR (`PROMPTPAY_ID`, default `0846301733`) + SlipOK verify (mock when key absent)

## Quick start (local)

```bash
cd /home/ubuntu/spinlytics-domain-checker
cp .env.example .env.local
# leave DATABASE_URL empty for PGlite
npm install
env -u DATABASE_URL npm run build
env -u DATABASE_URL npm start
# or for iteration: env -u DATABASE_URL npm run dev
```

Open http://localhost:3000

Prefer `build` + `start` for demos on this VM (dev HMR websocket can flake).

Default seeded admin (PGlite auto-seed on first query):

- Email: `admin@spinlytics.local`
- Password: `admin123!`

Or register a new account (starts on Free/Trial — 1 domain, hourly checks).

### Worker

Domain checks also run from the Next process (in-process fallback) and via:

```bash
# optional dedicated worker
env -u DATABASE_URL npm run worker

# or manual tick
curl -X POST http://localhost:3000/api/worker/tick
```

With Redis:

```bash
REDIS_URL=redis://127.0.0.1:6379 npm run worker
```

### Seed (Postgres only)

```bash
DATABASE_URL=postgres://... npm run seed
DATABASE_URL=postgres://... npm run migrate
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build + migrate |
| `npm start` | Production server |
| `npm run worker` | Background domain-check worker |
| `npm run seed` | Upsert plans + admin |
| `npm run migrate` | Apply `migrations/*.sql` |

## Env vars you must provide for production

| Var | Why |
|-----|-----|
| `JWT_SECRET` | Sign auth cookies |
| `PROMPTPAY_ID` | Merchant ID (defaults to `0846301733`) |
| `SLIPOK_API_KEY` (+ optional `SLIPOK_BRANCH_ID`) | Live slip verification |
| `TELEGRAM_BOT_TOKEN` | Bot for alerts + admin payment notices |
| `TELEGRAM_ADMIN_CHAT_ID` | Admin group for payment notifications |
| `REDIS_URL` | Optional; enables BullMQ |
| `WORKER_SECRET` | Protect `/api/worker/tick` |

`DATABASE_URL` is injected by Cursor publish-app when the app declares Postgres — do not hardcode it.

## Domain check assumptions

We cannot egress from each Thai ISP vantage point in this environment. A single HTTP probe looks for ministry/ISP block-page fingerprints (`ถูกระงับ`, `block.go.th`, status 451, etc.) and mirrors the result across AIS/TRUE/DTAC/3BB/NT. Multi-ISP residential proxies are a future upgrade. Set `DEMO_FORCE_BLOCK=1` to force BLOCKED for alert demos.

## Publish (Cursor)

1. Ensure `cursor-app.json` → `{ "database": "postgres" }` and `migrations/` are present.
2. From Cursor, use **publish-app** on `/home/ubuntu/spinlytics-domain-checker`.
3. Bind secrets (`JWT_SECRET`, PromptPay/SlipOK, Telegram) in the publish dialog / secrets UI.
4. Attach a Git remote later when a reachable repo URL is available — not required for publish-app.
