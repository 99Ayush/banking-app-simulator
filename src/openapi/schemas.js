const id = { type: "string", pattern: "^[a-fA-F0-9]{24}$" }
const money = { type: "integer", minimum: 0, maximum: 1000000000000, description: "Integer paise" }
const date = { type: "string", format: "date-time" }
const ref = (name) => ({ $ref: "#/components/schemas/" + name })
const object = (properties, required = []) => ({
    type: "object",
    properties,
    ...(required.length ? { required } : {})
})
const array = (name) => ({ type: "array", items: ref(name) })
const envelope = (data) =>
    object(
        {
            success: { type: "boolean", enum: [true] },
            status: { type: "integer" },
            message: { type: "string" },
            isIdempotentReplay: { type: "boolean" },
            ...(data ? { data } : {})
        },
        data ? ["success", "data"] : ["success"]
    )
const accountReference = {
    oneOf: [
        id,
        object({
            _id: id,
            accountNumber: { type: "string" },
            accountName: { type: "string" },
            accountType: { type: "string" },
            userId: id
        })
    ],
    nullable: true
}
const schemas = {
    User: object({
        _id: id,
        id,
        name: { type: "string" },
        email: { type: "string", format: "email" },
        role: { type: "string", enum: ["user", "admin"] }
    }),
    Account: object(
        {
            _id: id,
            id,
            userId: { oneOf: [id, ref("User")] },
            accountNumber: { type: "string" },
            accountName: { type: "string" },
            accountType: { type: "string", enum: ["SAVINGS", "CURRENT"] },
            balance: money,
            dailyTransferLimit: money,
            status: { type: "string", enum: ["ACTIVE", "FROZEN", "CLOSED"] },
            createdAt: date,
            updatedAt: date
        },
        ["accountNumber", "balance", "status"]
    ),
    Transaction: object(
        {
            _id: id,
            referenceId: { type: "string" },
            fromAccount: accountReference,
            toAccount: accountReference,
            amount: money,
            type: { type: "string", enum: ["TRANSFER", "DEPOSIT", "WITHDRAWAL"] },
            status: { type: "string", enum: ["PENDING", "COMPLETED", "FAILED"] },
            initiatedBy: id,
            performedBy: id,
            idempotencyKey: { type: "string" },
            failureReason: { type: "string" },
            failureCode: { type: "string" },
            attemptCount: { type: "integer" },
            createdAt: date,
            completedAt: date
        },
        ["_id", "referenceId", "amount", "type", "status"]
    ),
    Beneficiary: object(
        {
            _id: id,
            accountId: id,
            accountNumber: { type: "string" },
            name: { type: "string" },
            email: { type: "string" },
            nickname: { type: "string" },
            status: { type: "string", enum: ["VERIFIED", "PENDING"] }
        },
        ["_id", "accountNumber", "name", "status"]
    ),
    Posting: object(
        {
            ledgerAccount: { type: "string" },
            accountId: id,
            kind: { type: "string", enum: ["ASSET", "LIABILITY"] },
            normalSide: { type: "string", enum: ["DEBIT", "CREDIT"] },
            side: { type: "string", enum: ["DEBIT", "CREDIT"] },
            amount: money
        },
        ["ledgerAccount", "kind", "normalSide", "side", "amount"]
    ),
    Journal: object(
        {
            _id: id,
            operationId: { type: "string" },
            transactionId: id,
            performedBy: id,
            description: { type: "string" },
            createdAt: date,
            postings: array("Posting")
        },
        ["_id", "operationId", "postings"]
    ),
    Pagination: object(
        {
            total: { type: "integer", minimum: 0 },
            page: { type: "integer", minimum: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100 },
            totalPages: { type: "integer", minimum: 0 }
        },
        ["total", "page", "limit", "totalPages"]
    ),
    AuthResponse: envelope(
        object(
            {
                user: ref("User"),
                accessToken: { type: "string" },
                refreshToken: { type: "string" },
                csrfToken: { type: "string" }
            },
            ["user", "accessToken", "refreshToken", "csrfToken"]
        )
    ),
    MessageResponse: envelope(),
    AccountResponse: envelope(object({ account: ref("Account") }, ["account"])),
    AccountsResponse: envelope(object({ accounts: array("Account") }, ["accounts"])),
    BalanceResponse: envelope({
        oneOf: [
            ref("Account"),
            object({ accounts: array("Account"), totalBalance: { type: "integer", minimum: 0 } }, [
                "accounts",
                "totalBalance"
            ])
        ]
    }),
    MoneyResponse: envelope(
        object(
            {
                transactionId: id,
                referenceId: { type: "string" },
                accountId: id,
                balance: money,
                amount: money,
                status: { type: "string", enum: ["COMPLETED"] },
                fromAccount: id,
                toAccount: id
            },
            ["transactionId", "referenceId"]
        )
    ),
    TransactionResponse: envelope(object({ transaction: ref("Transaction") }, ["transaction"])),
    TransactionsResponse: envelope(
        object({ transactions: array("Transaction"), pagination: ref("Pagination") }, [
            "transactions",
            "pagination"
        ])
    ),
    FailedTransactionsResponse: envelope(
        object({ failedTransfers: array("Transaction"), pagination: ref("Pagination") }, [
            "failedTransfers",
            "pagination"
        ])
    ),
    JournalsResponse: envelope(
        object({ journals: array("Journal"), pagination: ref("Pagination") }, [
            "journals",
            "pagination"
        ])
    ),
    BeneficiaryResponse: envelope(object({ beneficiary: ref("Beneficiary") }, ["beneficiary"])),
    BeneficiariesResponse: envelope(
        object({ beneficiaries: array("Beneficiary") }, ["beneficiaries"])
    ),
    AdminUsersResponse: envelope(
        object({ users: array("User"), pagination: ref("Pagination") }, ["users", "pagination"])
    ),
    AdminAccountsResponse: envelope(
        object({ accounts: array("Account"), pagination: ref("Pagination") }, [
            "accounts",
            "pagination"
        ])
    ),
    StatusResponse: envelope(ref("Account")),
    ReconciliationResponse: envelope(
        object(
            {
                consistent: { type: "boolean" },
                accountCount: { type: "integer" },
                journalCount: { type: "integer" },
                checkedAt: date,
                issues: {
                    type: "array",
                    items: object(
                        {
                            code: { type: "string" },
                            accountId: id,
                            journalId: id,
                            transactionId: id,
                            storedBalance: money,
                            journalBalance: { type: "string" }
                        },
                        ["code"]
                    )
                },
                ledgerBalances: {
                    type: "object",
                    additionalProperties: {
                        type: "string",
                        description: "Exact paise balance as a decimal string"
                    }
                }
            },
            ["consistent", "accountCount", "journalCount", "checkedAt", "issues", "ledgerBalances"]
        )
    ),
    HealthResponse: object(
        {
            status: { type: "string", enum: ["healthy"] },
            uptime: { type: "number" },
            timestamp: date
        },
        ["status", "uptime", "timestamp"]
    ),
    ReadyResponse: object(
        {
            status: { type: "string", enum: ["ready", "unready"] },
            services: object(
                {
                    database: { type: "string", enum: ["connected", "disconnected"] },
                    redis: { type: "string", enum: ["connected", "disconnected"] }
                },
                ["database", "redis"]
            )
        },
        ["status", "services"]
    ),
    MetricsResponse: object(
        {
            success: { type: "boolean" },
            metrics: object({
                totalRequests: { type: "integer" },
                avgLatencyMs: { type: "number" },
                p95LatencyMs: { type: "number" },
                failedTransfers: { type: "integer" },
                statusCodes: { type: "object", additionalProperties: { type: "integer" } },
                uptimeSeconds: { type: "integer" },
                memoryUsage: { type: "object", additionalProperties: { type: "integer" } }
            })
        },
        ["success", "metrics"]
    )
}
function responseName(method, path) {
    if (["/api/auth/register", "/api/auth/login", "/api/auth/refresh"].includes(path))
        return "AuthResponse"
    if (path === "/health") return "HealthResponse"
    if (path === "/ready") return "ReadyResponse"
    if (path === "/metrics") return "MetricsResponse"
    if (path.endsWith("/reconciliation")) return "ReconciliationResponse"
    if (
        path.endsWith("/funding") ||
        path.endsWith("/deposit") ||
        path.endsWith("/withdraw") ||
        path.endsWith("/transfer") ||
        path.endsWith("/retry")
    )
        return "MoneyResponse"
    if (path.endsWith("/status")) return "StatusResponse"
    if (path.endsWith("/ledger")) return "JournalsResponse"
    if (path === "/api/v1/admin/users") return "AdminUsersResponse"
    if (path === "/api/v1/admin/accounts") return "AdminAccountsResponse"
    if (path.endsWith("/failed")) return "FailedTransactionsResponse"
    if (path.endsWith("/pending") || path === "/api/v1/transactions") return "TransactionsResponse"
    if (path === "/api/v1/transactions/{id}") return "TransactionResponse"
    if (path === "/api/v1/accounts/balance") return "BalanceResponse"
    if (path === "/api/v1/accounts/me") return "AccountsResponse"
    if (path === "/api/v1/accounts") return "AccountResponse"
    if (path === "/api/v1/beneficiaries")
        return method === "get" ? "BeneficiariesResponse" : "BeneficiaryResponse"
    if (path.endsWith("/verify")) return "BeneficiaryResponse"
    return "MessageResponse"
}
module.exports = { schemas, responseName }
