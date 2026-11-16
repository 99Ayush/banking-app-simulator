# Banking API Simulator

A backend-only banking simulator I built to explore what it actually takes to move money safely in software â€” not just â€œdebit A, credit Bâ€, but doing it atomically, making retries safe, and keeping a ledger you can audit.

Thereâ€™s **no UI** here. Itâ€™s a REST API you run locally and drive through Swagger or Postman (great for a recorded walkthrough).

> **Scope:** a portfolio simulator for learning/demo. Itâ€™s **not** a regulated/live banking system and doesnâ€™t talk to real payment or settlement rails.

## Why this exists (and what it shows)

- **Money as integers, not floats** â€” amounts are in **paise** (`25000` = â‚¹250.00) so arithmetic stays exact.
- **Transfers are all-or-nothing** â€” debit, credit, daily-limit reservation, journal posting, and completion commit inside a MongoDB transaction.
- **Retries without double-spending** â€” idempotency keys let a client replay the *same* request and get the same outcome after an uncertain response.
- **A ledger you can trust** â€” balanced double-entry journals, treated as immutable (fixes are new postings), plus reconciliation to check journals against balances/completed ops.
- **Real-world auth concerns** â€” access/refresh tokens with rotation, server-side session revocation, Redis-backed checks/rate limits (fail closed when Redis is down), CSRF protection for cookie flows, and account status controls (`ACTIVE` / `FROZEN` / `CLOSED`).

## Built with

| Layer | Whatâ€™s used |
| --- | --- |
| Runtime & API | Node.js (>= 22.13), Express 5, Zod, Swagger/OpenAPI |
| Data | MongoDB (Mongoose, replica set / transactions), Redis |
| Auth & security | JWT (access/refresh), bcrypt, Helmet, CORS, rate limiting, cookie-parser |
| Quality & ops | Jest + Supertest (+ mongodb-memory-server), ESLint, Prettier, Docker, GitHub Actions CI |

## Project layout

```text
server.js                    # boots the app: env, DB/Redis, listen, graceful shutdown
src/
  app.js                     # Express wiring: middleware, routes, docs, errors
  config/                    # env schema, MongoDB, Redis
  routes/                    # endpoints + validation
  controllers/               # request/response layer
  services/                  # business logic (transfers, ledger, auth, reconciliation)
  models/                    # Mongoose schemas & ledger hooks
  validators/                # Zod schemas (shared with OpenAPI)
  middleware/                # auth, CSRF, idempotency, rate limits, errors
  openapi/                   # OpenAPI document & schemas
  utils/                     # tokens, amount helpers, tx runner, logging
scripts/                     # doctor, seed, migrate, create-admin
tests/                       # unit, integration, Redis-backed tests
postman-collection.json      # ready-to-run Postman collection
.github/workflows/ci.yml     # CI
```

## Getting it running

**Youâ€™ll need:** Node.js 22.13+, MongoDB 7+ running as a **replica set** (for transactions), and Redis 7+. Docker Compose is the easiest path.

### Option A â€” Docker Compose (recommended)

```powershell
Copy-Item .env.example .env
# generate two secrets and put them in .env as JWT_SECRET and JWT_REFRESH_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up -d --build
docker compose exec api npm run seed
```

API lives at `http://localhost:3000` â€” sanity check `/health`, `/ready`, and `/api/docs`.

### Option B â€” Run locally against your own MongoDB/Redis

```powershell
npm ci
# fill in .env (MONGO_URI must be a replica set, REDIS_URL set)
npm run doctor   # run this first if anything fails to start
npm run dev
```

`npm run doctor` is read-only: it checks env vars, DB reachability/replica set, Redis, and a few settings that can bite you (rate limits, funding). Fix what it flags before debugging blindly.

### Dev accounts (after `npm run seed`)

| User  | Email             | Password          |
| ----- | ----------------- | ----------------- |
| Admin | admin@bank.com    | AdminPassword123! |
| Alice | alice@example.com | AlicePassword123! |
| Bob   | bob@example.com   | BobPassword123!  |

Seeding is dev-only (off in production) and wonâ€™t wipe existing history.

## Try it out (Swagger / Postman)

- **Swagger:** `http://localhost:3000/api/docs`
- **Postman:** import `postman-collection.json` â†’ run the **â€œBackend walkthroughâ€** folder in Collection Runner for a repeatable end-to-end demo.

A quick flow to see the interesting bits:

1. `POST /api/auth/login` â†’ grab `accessToken` (send as `Bearer` for API calls).
2. `GET /api/v1/accounts/me` â†’ pick a `senderAccountId` and a recipient account.
3. `POST /api/v1/transactions/transfer` with an `Idempotency-Key` header:
   ```json
   { "senderAccountId": "<SENDER_ID>", "toAccountId": "<RECIPIENT_ID>", "amount": 25000 }
   ```
4. Send the **same** key + body again â†’ same result, marked as a replay. Send the **same** key with a different payload â†’ `409`.
5. Poke around history/detail/ledger, and (as admin) run reconciliation to see journals and balances line up.

## A few behaviors worth knowing

- **Amounts:** integer paise, capped to stay within JS safe integer range.
- **Daily limits:** count completed **transfers** (not withdrawals), in the configured business timezone (default `Asia/Kolkata`).
- **Accounts:** Savings/Current; `ACTIVE` / `FROZEN` / `CLOSED` (only ACTIVE can send/receive; closing needs a zero balance).
- **Funding:** self-service deposits are a dev sandbox switch (`SANDBOX_DEPOSITS_ENABLED=true`) and disabled in production; admins can fund via `POST /api/v1/admin/accounts/:id/funding` (idempotent, recorded). No real payment settlement.
- **If a money call comes back uncertain** (e.g. 503 with a `transactionId`/reference): inspect or retry **that same operation/idempotency key** â€” donâ€™t mint a fresh key to â€œfixâ€ it.

## API at a glance

| Area | Examples |
| --- | --- |
| Auth | `POST /api/auth/register`, `/login`, `/refresh`, `/logout` |
| Accounts | create, list mine, balance, deposit/withdraw, ledger (`/api/v1/accounts...`) |
| Transactions | transfer, history/detail, retry (`/api/v1/transactions...`) |
| Beneficiaries | create/list/verify/delete (`/api/v1/beneficiaries`) |
| Admin | users, accounts, failed/pending txns, reconciliation, status/funding (`/api/v1/admin/*`) |
| Ops | `GET /health`, `/ready`, `/metrics`, `/api/docs` |

Full request/response shapes live in Swagger (`/api/docs`, `/api/docs.json`).

## Scripts & tests

```powershell
npm run doctor            # preflight: env, Mongo (replica set), Redis, risky settings
npm run lint
npm test                  # Jest, runInBand
npm run test:coverage
npm run test:redis        # needs TEST_REDIS_URL (e.g. redis://localhost:6379/15)
npm run migrate           # dry-run by default; add --apply for old DBs
npm run seed              # dev sample data
npm run audit:production
```

Tests spin up disposable MongoDB replica sets (a VM Modules warning during Jest runs is expected). Real Redis tests are separate and skip unless `TEST_REDIS_URL` is set. CI runs lint, coverage, a Compose config check, and a Docker build.

## Deployment & migrations (brief)

- Production expects distinct non-example secrets, an HTTPS cookie-client origin, and sandbox deposits off; docs/metrics are admin-gated in production.
- Migrating an existing DB: back it up, run `npm run migrate` (dry run) to inspect, then `npm run migrate -- --apply`. Migrations preserve balances and refuse to run with pending operations.
- Again: simulator/portfolio project â€” no claims of regulated deployment, measured scale, or real settlement.

## License

MIT · built by Ayush


