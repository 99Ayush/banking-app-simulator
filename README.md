<div align="center">

# 🏦 Banking API Simulator

**What it actually takes to move money safely in software — not "debit A, credit B", but atomic, idempotent and auditable.**

[![CI](https://github.com/99Ayush/banking-app-simulator/actions/workflows/ci.yml/badge.svg)](https://github.com/99Ayush/banking-app-simulator/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A522.13-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-replica%20set-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f?style=for-the-badge)](LICENSE)

[Why](#why-this-exists) · [Quick start](#getting-it-running) · [Try it](#try-it-out) · [API](#api-at-a-glance) · [Tests](#scripts--tests)

</div>

---

A backend-only banking simulator. **No UI** — it's a REST API you run locally and drive through Swagger or Postman, which makes it easy to record a walkthrough.

> **Scope:** a portfolio simulator for learning. It is **not** a regulated banking system and never touches real payment or settlement rails.

## Why this exists

Anyone can write `balance -= amount`. The interesting part is everything around that line: what happens when the process dies halfway through, when the client retries because the response was lost, when the same request arrives twice, when an operator needs to prove that the ledger still balances.

- **Money as integers, never floats.** Amounts are in **paise** (`25000` = ₹250.00), capped inside the JavaScript safe-integer range.
- **Transfers are all-or-nothing.** Debit, credit, daily-limit reservation, journal posting and completion all commit inside one MongoDB transaction.
- **Retries cannot double-spend.** An `Idempotency-Key` lets a client replay the *same* request and get the *same* outcome after an uncertain response.
- **The ledger is auditable.** Balanced double-entry journals, treated as immutable — fixes are new postings — with reconciliation that checks journals against balances and completed operations.
- **Auth is treated like production.** Access/refresh tokens with rotation, server-side session revocation, Redis-backed rate limits and checks that fail closed when Redis is down, CSRF protection for cookie flows, and account status controls (`ACTIVE` / `FROZEN` / `CLOSED`).

## Built with

| Layer | What's used |
| :--- | :--- |
| Runtime & API | Node.js ≥ 22.13, Express 5, Zod, Swagger/OpenAPI |
| Data | MongoDB (Mongoose, replica set for transactions), Redis |
| Auth & security | JWT access + refresh, bcrypt, Helmet, CORS, rate limiting, cookie-parser |
| Quality & ops | Jest + Supertest (+ `mongodb-memory-server`), ESLint, Prettier, Docker, GitHub Actions |

## Project layout

```text
server.js                    Boots the app: env, DB/Redis, listen, graceful shutdown
src/
  app.js                     Express wiring: middleware, routes, docs, errors
  config/                    Env schema, MongoDB, Redis
  routes/                    Endpoints + validation
  controllers/               Request/response layer
  services/                  Business logic: transfers, ledger, auth, reconciliation
  models/                    Mongoose schemas and ledger hooks
  validators/                Zod schemas (shared with OpenAPI)
  middleware/                auth, CSRF, idempotency, rate limits, errors
  openapi/                   OpenAPI document and schemas
  utils/                     Tokens, amount helpers, transaction runner, logging
scripts/                     doctor, seed, migrate, create-admin
tests/                       unit, integration, Redis-backed
postman-collection.json      Ready-to-run Postman collection
.github/workflows/ci.yml     Lint, coverage, Compose config check, Docker build
```

## Getting it running

**You'll need:** Node.js 22.13+, MongoDB 7+ running as a **replica set** (transactions), Redis 7+. Docker Compose is the fastest path.

### Option A — Docker Compose (recommended)

```powershell
Copy-Item .env.example .env
# generate two secrets and put them in .env as JWT_SECRET and JWT_REFRESH_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up -d --build
docker compose exec api npm run seed
```

The API lives at `http://localhost:3000` — sanity-check `/health`, `/ready` and `/api/docs`.

### Option B — Your own MongoDB and Redis

```powershell
npm ci
# fill in .env (MONGO_URI must be a replica set, REDIS_URL set)
npm run doctor   # run this first if anything fails to start
npm run dev
```

`npm run doctor` is **read-only**: it checks env vars, DB reachability and replica-set status, Redis, and a few settings that silently bite (rate limits, funding flags). Fix what it flags before debugging blindly.

### Dev accounts (after `npm run seed`)

| User | Email | Password |
| :--- | :--- | :--- |
| Admin | `admin@bank.com` | `AdminPassword123!` |
| Alice | `alice@example.com` | `AlicePassword123!` |
| Bob | `bob@example.com` | `BobPassword123!` |

Seeding is dev-only (disabled in production) and won't wipe existing history.

## Try it out

- **Swagger:** `http://localhost:3000/api/docs`
- **Postman:** import `postman-collection.json` and run the **"Backend walkthrough"** folder in Collection Runner for a repeatable end-to-end demo.

A short flow that shows the interesting parts:

1. `POST /api/auth/login` → take `accessToken`, send it as `Bearer`.
2. `GET /api/v1/accounts/me` → pick a `senderAccountId` and a recipient account.
3. `POST /api/v1/transactions/transfer` with an `Idempotency-Key` header:

   ```json
   { "senderAccountId": "<SENDER_ID>", "toAccountId": "<RECIPIENT_ID>", "amount": 25000 }
   ```

4. Send the **same** key and body again → same result, flagged as a replay. Send the **same** key with a *different* payload → `409`.
5. Explore history and detail views, then (as admin) run reconciliation and watch journals and balances line up.

## Behaviours worth knowing

- **Amounts** are integer paise, capped to stay inside the safe-integer range.
- **Daily limits** count completed **transfers** (not withdrawals), in the configured business timezone (default `Asia/Kolkata`).
- **Accounts** are Savings or Current; only `ACTIVE` accounts can send or receive, and closing one requires a zero balance.
- **Funding:** self-service deposits are a dev sandbox switch (`SANDBOX_DEPOSITS_ENABLED=true`), disabled in production. Admins fund accounts through `POST /api/v1/admin/accounts/:id/funding` (idempotent and recorded). No real settlement.
- **If a money call returns uncertain** (for example a 503 with a `transactionId` or reference): inspect or retry **that same operation and idempotency key**. Never mint a fresh key to "fix" it.

## API at a glance

| Area | Examples |
| :--- | :--- |
| Auth | `POST /api/auth/register`, `/login`, `/refresh`, `/logout` |
| Accounts | create, list mine, balance, deposit/withdraw, ledger (`/api/v1/accounts…`) |
| Transactions | transfer, history, detail, retry (`/api/v1/transactions…`) |
| Beneficiaries | create, list, verify, delete (`/api/v1/beneficiaries`) |
| Admin | users, accounts, failed/pending transfers, reconciliation, status, funding (`/api/v1/admin/*`) |
| Ops | `GET /health`, `/ready`, `/metrics`, `/api/docs` |

Full request and response shapes live in Swagger (`/api/docs`, `/api/docs.json`).

## Scripts & tests

```powershell
npm run doctor            # preflight: env, Mongo replica set, Redis, risky settings
npm run lint
npm test                  # Jest, runInBand
npm run test:coverage
npm run test:redis        # needs TEST_REDIS_URL (e.g. redis://localhost:6379/15)
npm run migrate           # dry run by default; add --apply for older databases
npm run seed              # dev sample data
npm run audit:production
```

Tests spin up disposable MongoDB replica sets, so no external database is needed for the main suite (a VM Modules warning during Jest runs is expected and harmless). Real-Redis tests are separate and skip unless `TEST_REDIS_URL` is set. CI runs lint, coverage, a Compose config check and a Docker build.

## Deployment & migrations, briefly

- Production expects distinct non-example secrets, an HTTPS cookie-client origin, and sandbox deposits switched off. Docs and metrics are admin-gated in production.
- Migrating an existing database: back it up, run `npm run migrate` (dry run) to inspect the plan, then `npm run migrate -- --apply`. Migrations preserve balances and refuse to run with pending operations.
- This remains a **simulator**: no claims of regulated deployment, measured scale or real settlement.

## License

[MIT](LICENSE) · built by [Ayush Kumar](https://github.com/99Ayush)
