# Banking API Simulator

A backend-only banking simulator built with **Node.js, Express, MongoDB, and Redis**. It models core money-movement workflows (accounts, transfers, deposits/withdrawals, history, admin controls) with a focus on correctness: atomic operations, idempotent retries, double-entry journals, session revocation, and reconciliation.

> **What this is:** a portfolio/backend simulator exposed as a REST API (no UI).  
> **What this is not:** a live, regulated banking system and not integrated with real payment/bank settlement providers.

## What recruiters and developers should know

**For recruiters (what this demonstrates):**
- **Correct money handling:** amounts are stored/processed as integer **paise** (`25000` = INR 250.00) to avoid floating-point issues.
- **Atomic transfers:** debit, credit, daily-limit reservation, journal posting, and completion commit together in a MongoDB transaction.
- **Safe retries/idempotency:** money requests can be replayed with the same idempotency key to recover safely from uncertain outcomes (no double-debit).
- **Ledger & auditability:** balanced double-entry journals; reconciliation checks journals vs. balances/completed operations.
- **Auth & security basics:** access/refresh token flow with rotation, server-side session revocation, Redis-backed checks/rate limits, CSRF for cookie flows, validation, and account status controls.
- **Engineering hygiene:** tests (unit/integration/Redis), Docker Compose, CI workflow, OpenAPI/Swagger docs, and a `doctor` preflight script.

**For developers (how to work with it):**
- API-first project: run locally, hit endpoints via **Swagger** (`/api/docs`) or **Postman** (`postman-collection.json`).
- Requires **MongoDB as a replica set** (transactions) and **Redis**. Docker Compose is the easiest local setup.
- Self-service deposits are a **dev sandbox** feature and must be explicitly enabled (`SANDBOX_DEPOSITS_ENABLED=true`); production config disables them. Admin funding is the controlled path.
- Uncertain money response (e.g. 503 with `transactionId/referenceId`): **inspect/retry that same operation/idempotency key**—never create a fresh key to “resolve” it.

## Tech stack

- **Runtime:** Node.js (>= 22.13; Docker/CI use Node 24), CommonJS
- **API:** Express 5, Zod validation, Swagger/OpenAPI
- **Data:** MongoDB (Mongoose, replica set/transactions), Redis
- **Auth/Security:** JWT access/refresh tokens, bcrypt, cookie-parser, Helmet, CORS, rate limiting
- **Quality/ops:** Jest + Supertest (+ mongodb-memory-server), ESLint, Prettier, Docker, GitHub Actions

## Project structure

```
server.js                    # Entrypoint: env validation, DB/Redis connect, start server & shutdown
src/
  app.js                     # Express app: middleware, routes, docs, error handling
  config/                    # Environment schema, MongoDB connection, Redis client
  routes/                    # Route definitions & validation wiring
  controllers/               # Request/response handling
  services/                  # Business logic (transfers, ledger/journals, auth, reconciliation)
  models/                    # Mongoose schemas & ledger hooks
  validators/                # Zod request schemas (shared with OpenAPI)
  middleware/                # Auth, CSRF, idempotency, rate limits, errors
  openapi/                   # OpenAPI document & schemas
  utils/                     # Tokens, amount helpers, DB transaction runner, logging
scripts/                     # doctor, seed, migrate, create-admin
tests/                       # unit, integration, and Redis-backed tests (+ setup-env)
.github/workflows/ci.yml     # CI pipeline
postman-collection.json      # Postman collection for API walkthrough/demo
```

## Getting started

### Prerequisites
- Node.js **22.13+**
- MongoDB **7+** configured as a **replica set**
- Redis **7+**
- (Recommended) Docker + Docker Compose

### Option A: Docker Compose (recommended)
```powershell
Copy-Item .env.example .env
# generate two separate secrets and set JWT_SECRET and JWT_REFRESH_SECRET in .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up -d --build
docker compose exec api npm run seed
```
API: `http://localhost:3000` — check `/health`, `/ready`, `/api/docs`.

### Option B: Run locally with your own MongoDB/Redis
```powershell
npm ci
# configure .env (MONGO_URI must point to a replica set, REDIS_URL set)
npm run doctor
npm run dev
```
> `npm run doctor` is the first thing to run if startup/config fails (checks env, DB reachability/replica set, Redis, and risky settings). It is read-only.

### Sample dev credentials (after `npm run seed`)
| User  | Email               | Password          |
|------|---------------------|-------------------|
| Admin | admin@bank.com      | AdminPassword123! |
| Alice | alice@example.com   | AlicePassword123! |
| Bob   | bob@example.com     | BobPassword123!  |

Seed is for development (disabled in production) and does not clear history.

## API usage (quick demo flow)

Use **Swagger** (`/api/docs`) or import **`postman-collection.json`** (Postman Collection Runner: **Backend walkthrough** folder for a repeatable flow).

1. **Login** `POST /api/auth/login` → get `accessToken`, `refreshToken`, `csrfToken`.
2. **Auth:** send `Authorization: Bearer <accessToken>` (API clients). For cookie flows, send `X-CSRF-Token` on mutating requests (including refresh).
3. **Accounts:** `GET /api/v1/accounts/me` to fetch owned account IDs (use explicit `senderAccountId` for transfers).
4. **Transfer** `POST /api/v1/transactions/transfer` with an `Idempotency-Key` header:
   ```json
   { "senderAccountId": "<SENDER_ID>", "toAccountId": "<RECIPIENT_ID>", "amount": 25000 }
   ```
5. **Replay:** same key+body returns the original result (`isIdempotentReplay`); same key with different payload → `409`.
6. **Inspect:** transaction history/detail/ledger; admins can run reconciliation.

Notes: idempotency keys (header/body must match) should be 4–128 chars; use keys for any money request that may be retried.

## Key behaviors & guarantees

- **Money format:** integer paise; per-operation/account capped to keep values within JS safe integer range.
- **Atomicity:** transfers update balances, limits, journals, and status within a MongoDB transaction.
- **Idempotency & recovery:** duplicate/retried requests resolve to the same outcome; uncertain commits can be recovered by reusing the original key or the retry endpoint.
- **Journals:** balanced double-entry postings (customer liability vs cash/clearing asset); journals are treated as immutable (corrections via new postings).
- **Daily limits:** apply to completed transfers (not withdrawals), in the configured business timezone (default `Asia/Kolkata`).
- **Accounts:** Savings/Current, statuses `ACTIVE` / `FROZEN` / `CLOSED` (only ACTIVE can send/receive; closed requires zero balance).
- **Funding:** dev sandbox deposits are opt-in (`SANDBOX_DEPOSITS_ENABLED=true`) and off in production; admins can fund via `POST /api/v1/admin/accounts/:id/funding` (idempotent, recorded). No real payment settlement.
- **Revocation/fail-closed:** logout/reuse revokes sessions; auth/rate-limiting paths rely on Redis and fail closed when unavailable.

## Main endpoints (summary)

| Area | Examples |
| --- | --- |
| Auth | `POST /api/auth/register`, `/login`, `/refresh`, `/logout` |
| Accounts | `POST /api/v1/accounts`, `GET /api/v1/accounts/me`, `/balance`, deposit/withdraw, ledger |
| Transactions | `POST /api/v1/transactions/transfer`, history/detail, `POST /api/v1/transactions/:id/retry` |
| Beneficiaries | create/list/verify/delete under `/api/v1/beneficiaries` |
| Admin | users/accounts, failed/pending txns, reconciliation, status/funding under `/api/v1/admin/*` |
| Ops | `GET /health`, `/ready`, `/metrics` (admin in prod), `/api/docs` |

See Swagger (`/api/docs`, `/api/docs.json`) for full request/response details.

## Scripts & testing

```powershell
npm ci
npm run doctor          # preflight: env, Mongo (replica set), Redis, key settings
npm run lint
npm test                # Jest (runInBand)
npm run test:coverage
npm run test:redis      # requires TEST_REDIS_URL (e.g. redis://localhost:6379/15)
npm run migrate         # dry-run by default; --apply to migrate old DB data
npm run seed            # dev sample data
npm run audit:production
```

- Tests use disposable MongoDB replica sets (a VM Modules warning during Jest runs is expected).
- Real Redis tests are separate and skipped unless `TEST_REDIS_URL` is provided. CI runs lint, coverage, Compose config check, and Docker build.

## Deployment notes

- Production expects distinct non-example secrets, HTTPS cookie-client origin, sandbox deposits disabled; docs/metrics require admin auth in production.
- For existing databases, back up and inspect `npm run migrate` (dry run) before `--apply`. Migrations preserve balances and refuse to run with pending operations.
- This is a simulator/portfolio project—no claim of regulated deployment, measured customer scale, or payment-provider settlement.

## License

ISC (see `package.json`). Author: Ayush.
