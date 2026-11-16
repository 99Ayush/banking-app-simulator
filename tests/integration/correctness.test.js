const request = require("supertest")
const mongoose = require("mongoose")
const { MongoMemoryReplSet } = require("mongodb-memory-server")

jest.mock("../../src/config/redis", () => ({
    get: jest.fn(),
    setEx: jest.fn(),
    isReady: true,
    ping: jest.fn().mockResolvedValue("PONG")
}))

const redisClient = require("../../src/config/redis")
const app = require("../../src/app")
const Account = require("../../src/models/account")
const Transaction = require("../../src/models/transaction")

let mongoServer

const credentials = (suffix = "p1") => ({
    name: `${suffix} User`,
    email: `${suffix}-${Date.now()}-${Math.random()}@example.com`,
    password: "SafePassword123!"
})

async function registerAndLogin(user) {
    const regRes = await request(app).post("/api/auth/register").send(user).expect(201)
    const token = regRes.headers["set-cookie"].find((c) => c.startsWith("token="))
    return token
}

beforeAll(async () => {
    process.env.JWT_SECRET = "integration-test-secret"
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    await mongoose.connect(mongoServer.getUri())
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()))
    redisClient.get.mockImplementation(async () => null)
    redisClient.setEx.mockImplementation(async () => "OK")
})

beforeEach(async () => {
    await Promise.all(
        Object.values(mongoose.models).map((model) => model.collection.deleteMany({}))
    )
})

afterAll(async () => {
    await mongoose.disconnect()
    await mongoServer.stop()
})

describe("Core correctness", () => {
    test("creates an authenticated account with zero opening balance", async () => {
        const user = credentials("acct-zero")
        const cookie = await registerAndLogin(user)

        const res = await request(app)
            .post("/api/v1/accounts")
            .set("Authorization", `Bearer ${cookie.split(";")[0].slice(6)}`)
            .send({ accountType: "SAVINGS", accountName: "My High-Yield Savings" })
            .expect(201)

        expect(res.body.success).toBe(true)
        expect(res.body.status).toBe(201)
        expect(res.body.data.account.balance).toBe(0)
        expect(res.body.data.account.accountNumber).toMatch(/^ACC/)
        expect(res.body.data.account.accountType).toBe("SAVINGS")
    })

    test("returns only the authenticated user's account balance", async () => {
        const userA = credentials("user-a")
        const userB = credentials("user-b")
        const cookieA = await registerAndLogin(userA)
        const cookieB = await registerAndLogin(userB)

        // Create accounts for both
        const acctARes = await request(app)
            .post("/api/v1/accounts")
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .send({ accountType: "SAVINGS", accountName: "User A Savings" })
            .expect(201)

        await request(app)
            .post("/api/v1/accounts")
            .set("Authorization", `Bearer ${cookieB.split(";")[0].slice(6)}`)
            .send({ accountType: "CURRENT", accountName: "User B Current" })
            .expect(201)

        // Deposit into user A account directly in db
        await Account.findByIdAndUpdate(acctARes.body.data.account.id, { balance: 50000 })

        // User A requests balance
        const balanceRes = await request(app)
            .get("/api/v1/accounts/balance")
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .expect(200)

        expect(balanceRes.body.success).toBe(true)
        expect(balanceRes.body.data.totalBalance).toBe(50000)
        expect(balanceRes.body.data.accounts.length).toBe(1)
        expect(balanceRes.body.data.accounts[0].accountName).toBe("User A Savings")
    })

    test("rejects floating-point money amounts with validation error", async () => {
        const user = credentials("float-money")
        const cookie = await registerAndLogin(user)

        await request(app)
            .post("/api/v1/accounts")
            .set("Authorization", `Bearer ${cookie.split(";")[0].slice(6)}`)
            .send({})
            .expect(201)

        const res = await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${cookie.split(";")[0].slice(6)}`)
            .send({
                toAccountId: new mongoose.Types.ObjectId().toString(),
                amount: 100.5 // floating point money
            })
            .expect(400)

        expect(res.body.success).toBe(false)
        expect(res.body.status).toBe(400)
        expect(res.body.code).toBe("VALIDATION_ERROR")
        expect(res.body.errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ field: "amount" })])
        )
    })

    test("handles malformed recipient account ID with uniform error response", async () => {
        const user = credentials("malformed-id")
        const cookie = await registerAndLogin(user)

        const res = await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${cookie.split(";")[0].slice(6)}`)
            .send({
                toAccountId: "invalid-hex-string-123",
                amount: 1000
            })
            .expect(400)

        expect(res.body.success).toBe(false)
        expect(res.body.status).toBe(400)
        expect(res.body.code).toBe("VALIDATION_ERROR")
    })

    test("ensures self-transfer check prevents any transaction record creation", async () => {
        const user = credentials("self-tx")
        const cookie = await registerAndLogin(user)

        const acctRes = await request(app)
            .post("/api/v1/accounts")
            .set("Authorization", `Bearer ${cookie.split(";")[0].slice(6)}`)
            .send({})
            .expect(201)

        const acctId = acctRes.body.data.account.id

        await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${cookie.split(";")[0].slice(6)}`)
            .send({
                toAccountId: acctId,
                amount: 500
            })
            .expect(400)

        // Zero transactions should be created
        const txCount = await Transaction.countDocuments()
        expect(txCount).toBe(0)
    })
})
