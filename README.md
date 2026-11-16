# Banking Backend API

A backend banking simulator built with Node.js, Express, MongoDB, and Redis. It implements atomic money operations, balanced double-entry journals, idempotent recovery, session revocation, account controls, and reconciliation.

This project exposes APIs and Swagger documentation. All monetary inputs are integer paise: **25000 = INR 250.00**. Each operation and account balance is limited to 1,000,000,000,000 paise to keep arithmetic within JavaScript's exact integer range.

## Implemented features

- **Atomic transfers:** conditional sufficient-funds debits, recipient credits, daily allowance reservations, journal postings, and completion commit together in a MongoDB transaction.
- **Safe recovery:** the driver retries an uncertain commit on the same transaction. Persisted pending operations can be resolved by repeating the original idempotency key or calling the owned retry endpoint.
- **Idempotency:** a partial unique index on request account and key avoids collisions for unkeyed operations. Fingerprints reject reuse with different payment details. Concurrent identical requests return the same transaction; deposits and withdrawals also accept keys.
- **Double-entry journals:** customer accounts are credit-normal liabilities, and cash/clearing accounts are debit-normal assets. Every journal has equal debits and credits. Model APIs prohibit mutation and deletion; corrections require additional postings rather than editing history.
- **Reconciliation:** a consistent MongoDB snapshot checks balanced journals, cached customer balances, and journal presence for completed operations.
- **Authentication:** bcrypt password hashes; 15-minute access tokens; 7-day refresh tokens with unique identifiers, distinct signing secrets, explicit token types, issuer and audience checks, and atomic rotation.
- **Revocation:** server-side sessions are revoked on logout. Refresh reuse invalidates every session for the user. Redis contains SHA-256 access-token hashes with TTL, never raw JWT keys. Authentication fails closed when Redis is unavailable.
- **Security:** public registration creates ordinary users only; signed session-bound CSRF protection applies to cookie requests including refresh; valid bearer credentials take precedence; five failed logins cause a 15-minute lockout; Helmet, exact CORS origins, and a 10KB body limit.
- **Distributed limits:** Redis Lua counters share authentication and API limits between instances; transfers are limited by authenticated user. IPv6 address handling uses the rate-limit library's default normalization. Redis failures reject requests.
- **Banking workflows:** named Savings/Current accounts; explicit sender selection; deposits, withdrawals, transaction detail/history, beneficiary verification, daily transfer limits, and ACTIVE/FROZEN/CLOSED account controls.
- **Administration:** paginated user/account/failed-transfer APIs, pending-operation inspection, controlled idempotent funding, account status changes, and reconciliation.
- **Operations:** liveness, dependency readiness, request IDs, optional structured request logs, counts, average/p95 latency, clean shutdown, Docker, CI, Postman, and OpenAPI.

Daily limits count completed **transfers**, not withdrawals, in the configured IANA business timezone (default Asia/Kolkata). Allowance resets are reconstructed from completed transfers inside the same transaction as the debit.

## Requirements

- Node.js **22.13+**; Docker and CI use Node.js 24.
- MongoDB 7+ configured as a replica set, including for local development.
- Redis 7+.
- Docker Compose is the easiest way to run all three services.

## Quick start with Docker Compose

From this project directory:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Put the two separately generated values in JWT_SECRET and JWT_REFRESH_SECRET in .env, then run:

```
docker compose up -d --build
docker compose exec api npm run seed
```

The API is at http://localhost:3000. Open /health, /ready, or /api/docs. The seed command preserves existing records and only creates missing sample accounts; it never clears transaction history.

Development sample credentials:

| User | Email | Password |
| --- | --- | --- |
| Admin | admin@bank.com | AdminPassword123! |
| Alice | alice@example.com | AlicePassword123! |
| Bob | bob@example.com | BobPassword123! |

Alice has Savings and Current accounts. Pass senderAccountId explicitly when transferring. Seed is disabled in production.

To run Node directly against separately configured local services:

```
npm ci
npm run dev
```

The standalone MongoDB URI must address a real replica set. The Compose MongoDB hostname is internal to Compose; running the complete Compose stack avoids host-resolution mismatches.

## API authentication and demo

Import [postman-collection.json](postman-collection.json), or use Swagger. After seeding, run only the **Backend walkthrough** folder in Postman's Collection Runner for a repeatable demo. It logs in sample users, funds Alice once for that run, transfers, checks replay and changed-payload rejection, inspects journals, reconciles, then logs out. Other folders are an endpoint catalog for individual requests.

1. Log in through POST /api/auth/login. The response supplies accessToken, refreshToken, and csrfToken.
2. For API clients, set **Authorization: Bearer ACCESS_TOKEN**. Retain the refresh token securely and submit it in the JSON body of POST /api/auth/refresh.
3. For cookie clients, retain the token, refreshToken, and csrf-token cookies and send **X-CSRF-Token** with the issued csrfToken on mutating requests, including refresh.
4. Get /api/v1/accounts/me to obtain owned account IDs. A recipient account ID can be obtained using the recipient's own authenticated account listing.
5. Make a transfer using this body and an Idempotency-Key header:

```json
{
  "senderAccountId": "SENDER_ACCOUNT_OBJECT_ID",
  "toAccountId": "RECIPIENT_ACCOUNT_OBJECT_ID",
  "amount": 25000
}
```

6. Repeat the same key and body: the API returns the original transaction with isIdempotentReplay. A different amount or recipient with that key returns 409.
7. Check transaction history and the account ledger. Administrators can run reconciliation.

Header and body idempotency keys must agree and contain 4–128 trimmed characters. Unkeyed requests are separate operations; use keys for every money request that may be retried.

## Funding and account controls

Self-service deposits are a development sandbox feature and are **opt-in**: only `SANDBOX_DEPOSITS_ENABLED=true` enables them for ordinary users, so an unset value leaves them closed. Production disables them; authorized administrators can record funding through POST /api/v1/admin/accounts/:id/funding with a mandatory key. The funding administrator is recorded in the transaction and journal.

Funding represents a manually authorized simulator event. There is no external payment processor or live bank settlement integration. The cash ledger makes its accounting effect explicit.

Only ACTIVE accounts can send or receive money. Administrators can freeze/activate accounts, or close an account whose balance is zero. Closed accounts cannot reopen.

Beneficiary verification checks that the target account exists and is active and, if an email was supplied, that it matches the account owner. It is local account verification.

## API endpoints

| Method | Endpoint | Access |
| --- | --- | --- |
| POST | /api/auth/register | Public; ordinary user only |
| POST | /api/auth/login | Public |
| POST | /api/auth/refresh | Refresh token; CSRF with cookies |
| POST | /api/auth/logout | Access token; CSRF with cookies |
| POST | /api/v1/accounts | Authenticated |
| GET | /api/v1/accounts/me | Authenticated |
| GET | /api/v1/accounts/balance | Authenticated; optional accountId |
| POST | /api/v1/accounts/:accountId/deposit | Owner; sandbox only |
| POST | /api/v1/accounts/:accountId/withdraw | Owner |
| GET | /api/v1/accounts/:accountId/ledger | Owner |
| POST | /api/v1/transactions/transfer | Authenticated |
| GET | /api/v1/transactions | Owned history with validated filters |
| GET | /api/v1/transactions/:id | Participant or admin |
| POST | /api/v1/transactions/:id/retry | Initiating user |
| POST | /api/v1/beneficiaries | Authenticated |
| GET | /api/v1/beneficiaries | Authenticated |
| PATCH | /api/v1/beneficiaries/:id/verify | Owner |
| DELETE | /api/v1/beneficiaries/:id | Owner |
| GET | /api/v1/admin/users | Admin |
| GET | /api/v1/admin/accounts | Admin |
| GET | /api/v1/admin/transactions/failed | Admin |
| GET | /api/v1/admin/transactions/pending | Admin |
| GET | /api/v1/admin/ledger/reconciliation | Admin |
| PATCH | /api/v1/admin/accounts/:id/status | Admin |
| POST | /api/v1/admin/accounts/:id/funding | Admin; idempotency key required |
| GET | /health | Public |
| GET | /ready | Public; 503 for unavailable dependencies |
| GET | /metrics | Admin in production |
| GET | /api/docs, /api/docs.json | Admin in production |

History accepts page, limit (capped at 100), sort, status, type, startDate, endDate, and accountId. Account journals accept page, limit, sort, startDate, and endDate and include pagination totals. Administrator list endpoints accept page and limit, with a default limit of 50. Dates use ISO 8601 including explicit offsets. Unknown fields and malformed filters are rejected.

## Failure and recovery contract

- Validation, insufficient funds, frozen accounts, missing accounts, and daily-limit failures abort money changes.
- Failed business operations retain their failure reason and replay the same failure.
- A 503 money response includes transactionId/referenceId when an operation record exists. Inspect or retry that **same identity**; never generate a fresh key to resolve an uncertain result.
- After a worker crash, the original pending record can be completed. Its transaction record is locked inside the money transaction, so competing recovery requests cannot debit twice.
- Refresh reuse conservatively revokes all sessions. Clients should serialize refresh calls and log in again after reuse rejection.

## Existing databases

Before starting the upgraded API against an old database, stop the old API, back up the database, and inspect the migration:

```
npm run migrate
npm run migrate -- --apply
```

The default command is a dry run. Apply replaces the old sparse idempotency index, fills legacy operation metadata, and creates balanced **opening checkpoints** for existing balances without changing those balances. It refuses to proceed with pending operations.

Opening checkpoints establish a starting point; they do not reconstruct or certify historical accounting. Legacy transaction records remain available. Newly created accounts start at zero and every money movement thereafter has a journal.

## Tests and code quality

```
npm ci
npm run doctor
npm run lint
npm test
npm run test:coverage
npm run audit:production
```

`npm run doctor` is the first command to run when the API will not start. It checks the environment variables, resolves the database host, verifies that MongoDB is reachable and running as a replica set, pings Redis, and reports deployment settings that would cause rate limits or funding to misbehave. It is read-only and exits non-zero on a blocking problem.

Tests use disposable MongoDB replica sets and preserve indexes between cases. The npm test scripts enable Node's VM module support for the MongoDB driver's dynamic imports under Jest; a VM Modules experimental warning during tests is expected. The suite covers access/refresh separation, revocation and reuse, signed CSRF, privilege injection, concurrent duplicate transfers, uncertain successful commits, daily limits, frozen accounts, withdrawals, journal immutability, reconciliation, ownership, and recovery.

Real Redis tests use separate clients and randomly prefixed test keys:

```powershell
$env:TEST_REDIS_URL = 'redis://localhost:6379/15'
npm run test:redis
```

Without TEST_REDIS_URL, that suite is skipped explicitly. CI provides Redis and runs it with coverage, lint, a Compose configuration check, and a Docker build. Local integration tests mock Redis to isolate database and API behavior; those tests do not substitute for the real Redis suite.

## Project layout

```
server.js            process entry: configuration, database, listener
src/
  app.js             Express app: middleware order, routes, utils, error handling
  config/            environment schema, database connection, Redis client
  routes/            URL definitions and validation wiring
  controllers/       request and response translation
  services/          business rules: money movement, journals, sessions, reconciliation
  models/            Mongoose schemas and ledger hooks
  validators/        Zod schemas shared by routes and the OpenAPI document
  middleware/        authentication, CSRF, idempotency, rate limits, error handling
  openapi/           OpenAPI document and response schemas
  utils/             tokens, amount arithmetic, transaction runner, logging
scripts/             seed, migrate, doctor, create-admin
scripts/             seed, migrate, doctor, create-admin
```

## Deployment and project details

See [deployment](docs/deployment.md) and [architecture](docs/architecture.md). Interview preparation material, including the resume bullets, lives in [interview-guide](docs/interview-guide.md).

Production validates distinct non-example secrets, requires an HTTPS cookie-client origin, and disables sandbox deposits. Swagger and metrics require admin authentication. Journal immutability is enforced through application/model APIs; production database roles should separately deny journal updates/deletes. Operators and direct database administrators remain outside that application boundary.

This is a portfolio backend and a banking simulator, with no claim of live regulated banking deployment, measured customer scale, or payment-provider settlement.

License: ISC.
