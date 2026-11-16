const mongoose = require("mongoose")
const { runTransaction } = require("../../src/utils/database-transaction")
const { envSchema } = require("../../src/config/env")
afterEach(() => jest.restoreAllMocks())
test("an exhausted uncertain commit is never retried as a new business operation", async () => {
    const unknown = new Error("uncertain")
    unknown.hasErrorLabel = (label) => label === "UnknownTransactionCommitResult"
    const session = { withTransaction: jest.fn().mockRejectedValue(unknown), endSession: jest.fn() }
    jest.spyOn(mongoose, "startSession").mockResolvedValue(session)
    const callback = jest.fn()
    await expect(runTransaction(callback)).rejects.toMatchObject({
        statusCode: 503,
        code: "COMMIT_UNCERTAIN"
    })
    expect(session.withTransaction).toHaveBeenCalledTimes(1)
    expect(session.endSession).toHaveBeenCalledTimes(1)
})
test("production configuration rejects identical secrets, sandbox deposits, and HTTP cookie origins", () => {
    const valid = {
        NODE_ENV: "production",
        MONGO_URI: "mongodb://localhost/db?replicaSet=rs0",
        REDIS_URL: "rediss://localhost:6379",
        JWT_SECRET: "0123456789abcdef0123456789abcdef",
        JWT_REFRESH_SECRET: "abcdef0123456789abcdef0123456789",
        SANDBOX_DEPOSITS_ENABLED: "false",
        CLIENT_URL: "https://example.com"
    }
    expect(envSchema.safeParse(valid).success).toBe(true)
    for (const override of [
        { JWT_REFRESH_SECRET: valid.JWT_SECRET },
        { SANDBOX_DEPOSITS_ENABLED: "true" },
        { CLIENT_URL: "http://localhost:3000" },
        { BANK_TIMEZONE: "Invalid/Timezone" },
        { DAILY_TRANSFER_LIMIT_PAISE: "NaN" }
    ]) {
        expect(envSchema.safeParse({ ...valid, ...override }).success).toBe(false)
    }
})
