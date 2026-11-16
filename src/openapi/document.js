const swaggerUi = require("swagger-ui-express")
const { z } = require("zod")
const auth = require("../validators/auth")
const account = require("../validators/account")
const { transferSchema } = require("../validators/transaction")
const { createBeneficiarySchema } = require("../validators/beneficiary")
const { protectRoute, requireRole } = require("../middleware/auth")
const { schemas: responseSchemas, responseName } = require("./schemas")
const bodySchema = (schema) => z.toJSONSchema(schema, { target: "openapi-3.0" })
const queryParameters = [
    { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
    {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 20 }
    },
    { name: "sort", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
    {
        name: "status",
        in: "query",
        schema: { type: "string", enum: ["PENDING", "COMPLETED", "FAILED"] }
    },
    {
        name: "type",
        in: "query",
        schema: { type: "string", enum: ["TRANSFER", "DEPOSIT", "WITHDRAWAL"] }
    },
    ...["startDate", "endDate"].map((name) => ({
        name,
        in: "query",
        schema: { type: "string", format: "date-time" }
    })),
    { name: "accountId", in: "query", schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }
]
const definitions = [
    ["post", "/api/auth/register", "Register an ordinary user", auth.registerSchema, false],
    [
        "post",
        "/api/auth/login",
        "Issue access, refresh, and signed CSRF tokens",
        auth.loginSchema,
        false
    ],
    [
        "post",
        "/api/auth/refresh",
        "Atomically rotate a refresh token",
        auth.refreshTokenSchema,
        false
    ],
    ["post", "/api/auth/logout", "Revoke the session and blacklist the access token", null, true],
    [
        "post",
        "/api/v1/accounts",
        "Create a named account with zero opening balance",
        account.createAccountSchema,
        true
    ],
    ["get", "/api/v1/accounts/me", "List owned accounts", null, true],
    ["get", "/api/v1/accounts/balance", "Get owned account balances", null, true],
    [
        "get",
        "/api/v1/accounts/{accountId}/ledger",
        "Read immutable journal postings for an owned account",
        null,
        true
    ],
    [
        "post",
        "/api/v1/accounts/{accountId}/deposit",
        "Add sandbox funds; disabled in production",
        account.depositWithdrawSchema,
        true
    ],
    [
        "post",
        "/api/v1/accounts/{accountId}/withdraw",
        "Withdraw funds with balanced journal postings",
        account.depositWithdrawSchema,
        true
    ],
    [
        "post",
        "/api/v1/transactions/transfer",
        "Transfer atomically with replay and daily allowance reservation",
        transferSchema,
        true
    ],
    ["get", "/api/v1/transactions", "Read paginated owned transaction history", null, true],
    ["get", "/api/v1/transactions/{id}", "Read one owned transaction", null, true],
    [
        "post",
        "/api/v1/transactions/{id}/retry",
        "Resolve the original pending operation without a second debit",
        null,
        true
    ],
    [
        "post",
        "/api/v1/beneficiaries",
        "Add and verify an active recipient account",
        createBeneficiarySchema,
        true
    ],
    ["get", "/api/v1/beneficiaries", "List owned beneficiaries", null, true],
    [
        "patch",
        "/api/v1/beneficiaries/{id}/verify",
        "Recheck the recipient account and optional owner email",
        null,
        true
    ],
    ["delete", "/api/v1/beneficiaries/{id}", "Remove an owned beneficiary", null, true],
    ["get", "/api/v1/admin/users", "List users", null, true],
    ["get", "/api/v1/admin/accounts", "List accounts", null, true],
    ["get", "/api/v1/admin/transactions/failed", "List failed transfers", null, true],
    [
        "get",
        "/api/v1/admin/transactions/pending",
        "List recoverable pending operations",
        null,
        true
    ],
    [
        "get",
        "/api/v1/admin/ledger/reconciliation",
        "Check balanced postings and cached balances in a snapshot",
        null,
        true
    ],
    [
        "patch",
        "/api/v1/admin/accounts/{id}/status",
        "Freeze, activate, or close a zero-balance account",
        z.object({ status: z.enum(["ACTIVE", "FROZEN", "CLOSED"]) }).strict(),
        true
    ],
    [
        "post",
        "/api/v1/admin/accounts/{id}/funding",
        "Record administrator-authorized funding with a mandatory idempotency key",
        account.depositWithdrawSchema,
        true
    ],
    ["get", "/health", "Process liveness", null, false],
    ["get", "/ready", "MongoDB and Redis readiness", null, false],
    [
        "get",
        "/metrics",
        "Request counts, errors, latency, and process metrics; admin in production",
        null,
        false
    ]
]
const paths = {}
for (const [method, path, summary, schema, secured] of definitions) {
    const parameters = [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
        name: match[1],
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" }
    }))
    if (method !== "get")
        parameters.push({
            name: "X-CSRF-Token",
            in: "header",
            description:
                "Required with cookie credentials; use the issued csrfToken and csrf-token cookie.",
            schema: { type: "string" }
        })
    if (
        path.endsWith("/transfer") ||
        path.endsWith("/deposit") ||
        path.endsWith("/withdraw") ||
        path.endsWith("/funding")
    ) {
        parameters.push({
            name: "Idempotency-Key",
            in: "header",
            required: path.endsWith("/funding"),
            description: "Reuse the same key and payment details after timeouts.",
            schema: { type: "string", minLength: 4, maxLength: 128 }
        })
    }
    if (path === "/api/v1/transactions") parameters.push(...queryParameters)
    else if (path.endsWith("/ledger"))
        parameters.push(...queryParameters.slice(0, 3), ...queryParameters.slice(5, 7))
    else if (
        method === "get" &&
        path.startsWith("/api/v1/admin/") &&
        !path.endsWith("reconciliation")
    )
        parameters.push(queryParameters[0], {
            ...queryParameters[1],
            schema: { ...queryParameters[1].schema, default: 50 }
        })
    else if (path.endsWith("/balance")) parameters.push(queryParameters[7])
    const responses = {}
    for (const code of [200, 400, 401, 403, 404, 409, 422, 423, 429, 503])
        responses[code] = {
            description: code === 200 ? "Successful response" : "Error response",
            content: {
                "application/json": {
                    schema: {
                        $ref:
                            code === 200
                                ? "#/components/schemas/" + responseName(method, path)
                                : "#/components/schemas/ErrorResponse"
                    }
                }
            }
        }
    if (
        path.endsWith("/register") ||
        path === "/api/v1/accounts" ||
        (path === "/api/v1/beneficiaries" && method === "post")
    ) {
        responses[201] = responses[200]
        delete responses[200]
    }
    if (path === "/ready")
        responses[503] = {
            ...responses[200],
            description: "One or more dependencies are unavailable"
        }
    paths[path] ||= {}
    paths[path][method] = {
        summary,
        tags: [
            path.includes("/admin/")
                ? "Administration"
                : path.startsWith("/api/auth/")
                  ? "Authentication"
                  : path.split("/")[3] || "Operations"
        ],
        parameters,
        responses,
        ...(secured || path === "/metrics"
            ? { security: [{ bearerAuth: [] }, { cookieAuth: [] }] }
            : {}),
        ...(path.includes("/admin/") ? { "x-required-role": "admin" } : {}),
        ...(schema
            ? {
                  requestBody: {
                      required: path !== "/api/auth/refresh",
                      content: { "application/json": { schema: bodySchema(schema) } }
                  }
              }
            : {})
    }
}
const swaggerDocument = {
    openapi: "3.0.3",
    info: {
        title: "Banking Backend API",
        version: "2.0.0",
        description:
            "Backend banking simulator with atomic transfers, balanced journals, session revocation, Redis rate limits, and reconciliation. Monetary request amounts are integer paise."
    },
    servers: [{ url: process.env.API_URL || "http://localhost:3000" }],
    components: {
        securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
            cookieAuth: { type: "apiKey", in: "cookie", name: "token" }
        },
        schemas: {
            ...responseSchemas,
            SuccessResponse: {
                type: "object",
                properties: {
                    success: { type: "boolean" },
                    data: { type: "object", additionalProperties: true }
                }
            },
            ErrorResponse: {
                type: "object",
                properties: {
                    success: { type: "boolean", example: false },
                    status: { type: "integer" },
                    code: { type: "string" },
                    message: { type: "string" },
                    requestId: { type: "string" },
                    data: { type: "object", additionalProperties: true },
                    errors: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: { field: { type: "string" }, message: { type: "string" } }
                        }
                    }
                }
            }
        }
    },
    paths
}
function docsGuard(req, res, next) {
    if (process.env.NODE_ENV !== "production") return next()
    protectRoute(req, res, (err) => (err ? next(err) : requireRole("admin")(req, res, next)))
}
function setupSwagger(app) {
    app.use("/api/docs", docsGuard, swaggerUi.serve, swaggerUi.setup(swaggerDocument))
    app.get("/api/docs.json", docsGuard, (req, res) => res.json(swaggerDocument))
}
module.exports = { swaggerDocument, setupSwagger, definitions }
