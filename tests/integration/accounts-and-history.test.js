const request = require("supertest")
const mongoose = require("mongoose")
const { MongoMemoryReplSet } = require("mongodb-memory-server")

jest.mock("../../src/config/redis", () => ({
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue("OK"),
    isReady: true,
    ping: jest.fn().mockResolvedValue("PONG")
}))

const app = require("../../src/app")
const User = require("../../src/models/user")
const Account = require("../../src/models/account")
const Transaction = require("../../src/models/transaction")

let mongoServer

const credentials = (suffix = "p4") => ({
    name: `${suffix} User`,
    email: `${suffix}-${Date.now()}-${Math.random()}@example.com`,
    password: "SafePassword123!"
})

async function registerAndLogin(user) {
    const regRes = await request(app).post("/api/auth/register").send(user).expect(201)
    return regRes.headers["set-cookie"].find((c) => c.startsWith("token="))
}

beforeAll(async () => {
    process.env.JWT_SECRET = "integration-test-secret"
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    await mongoose.connect(mongoServer.getUri())
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()))
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

describe("Banking product features", () => {
    test("supports deposit and withdrawal with proper audit trail", async () => {
        const user = credentials("dep-with")
        const cookie = await registerAndLogin(user)

        const acctRes = await request(app)
            .post("/api/v1/accounts")
            .set("Authorization", `Bearer ${cookie.split(";")[0].slice(6)}`)
            .send({ accountType: "SAVINGS", accountName: "Daily Savings" })
            .expect(201)

        const acctId = acctRes.body.data.account.id

        // 1. Deposit 50,000 paise
        const depRes = await request(app)
            .post(`/api/v1/accounts/${acctId}/deposit`)
            .set("Authorization", `Bearer ${cookie.split(";")[0].slice(6)}`)
            .send({ amount: 50000 })
            .expect(200)

        expect(depRes.body.success).toBe(true)
        expect(depRes.body.data.balance).toBe(50000)

        // Verify deposit transaction
        const depTx = await Transaction.findById(depRes.body.data.transactionId)
        expect(depTx.type).toBe("DEPOSIT")
        expect(depTx.status).toBe("COMPLETED")

        // 2. Withdraw 20,000 paise
        const withRes = await request(app)
            .post(`/api/v1/accounts/${acctId}/withdraw`)
            .set("Authorization", `Bearer ${cookie.split(";")[0].slice(6)}`)
            .send({ amount: 20000 })
            .expect(200)

        expect(withRes.body.success).toBe(true)
        expect(withRes.body.data.balance).toBe(30000)

        // Verify withdrawal transaction
        const withTx = await Transaction.findById(withRes.body.data.transactionId)
        expect(withTx.type).toBe("WITHDRAWAL")
        expect(withTx.status).toBe("COMPLETED")

        // 3. Reject overdraft withdrawal
        await request(app)
            .post(`/api/v1/accounts/${acctId}/withdraw`)
            .set("Authorization", `Bearer ${cookie.split(";")[0].slice(6)}`)
            .send({ amount: 40000 })
            .expect(400)
    })

    test("enforces daily transfer limits", async () => {
        const sender = credentials("limit-sender")
        const receiver = credentials("limit-receiver")
        const senderCookie = await registerAndLogin(sender)
        await registerAndLogin(receiver)

        // Create sender account with 50,000 paise daily limit and 100,000 balance
        const senderUser = await User.findOne({ email: sender.email })
        await Account.create({
            userId: senderUser._id,
            balance: 100000,
            dailyTransferLimit: 50000
        })

        const receiverUser = await User.findOne({ email: receiver.email })
        const receiverAcct = await Account.create({
            userId: receiverUser._id,
            balance: 0
        })

        // Transfer 40,000 paise (allowed)
        await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
            .send({ toAccountId: receiverAcct._id.toString(), amount: 40000 })
            .expect(200)

        // Attempt transfer of 15,000 paise (40,000 + 15,000 = 55,000 > 50,000 limit)
        const limitRes = await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
            .send({ toAccountId: receiverAcct._id.toString(), amount: 15000 })
            .expect(400)

        expect(limitRes.body.success).toBe(false)
        expect(limitRes.body.message).toMatch(/Daily transfer limit exceeded/i)
    })

    test("manages beneficiaries: add, list, verify, remove", async () => {
        const userA = credentials("benef-owner")
        const userB = credentials("benef-target")
        const cookieA = await registerAndLogin(userA)
        await registerAndLogin(userB)

        const userBModel = await User.findOne({ email: userB.email })
        await Account.create({
            userId: userBModel._id,
            accountNumber: "ACC987654321",
            balance: 0
        })

        // Add beneficiary
        const addRes = await request(app)
            .post("/api/v1/beneficiaries")
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .send({
                accountNumber: "ACC987654321",
                name: "Bob Target",
                email: userB.email,
                nickname: "Bob Personal"
            })
            .expect(201)

        expect(addRes.body.success).toBe(true)
        const beneficiaryId = addRes.body.data.beneficiary._id

        // List beneficiaries
        const listRes = await request(app)
            .get("/api/v1/beneficiaries")
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .expect(200)

        expect(listRes.body.data.beneficiaries.length).toBe(1)
        expect(listRes.body.data.beneficiaries[0].accountNumber).toBe("ACC987654321")

        // Verify beneficiary
        const verifyRes = await request(app)
            .patch(`/api/v1/beneficiaries/${beneficiaryId}/verify`)
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .expect(200)

        expect(verifyRes.body.data.beneficiary.status).toBe("VERIFIED")

        // Remove beneficiary
        await request(app)
            .delete(`/api/v1/beneficiaries/${beneficiaryId}`)
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .expect(200)

        const listAfter = await request(app)
            .get("/api/v1/beneficiaries")
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .expect(200)

        expect(listAfter.body.data.beneficiaries.length).toBe(0)
    })

    test("transaction detail endpoint protects ownership boundaries", async () => {
        const userA = credentials("owner-a")
        const userB = credentials("owner-b")
        const intruder = credentials("intruder")

        const cookieA = await registerAndLogin(userA)
        await registerAndLogin(userB)
        const cookieIntruder = await registerAndLogin(intruder)

        const userAModel = await User.findOne({ email: userA.email })
        const userBModel = await User.findOne({ email: userB.email })

        await Account.create({ userId: userAModel._id, balance: 50000 })
        const acctB = await Account.create({ userId: userBModel._id, balance: 10000 })

        // Transfer funds from A to B
        const txRes = await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .send({ toAccountId: acctB._id.toString(), amount: 10000 })
            .expect(200)

        const txId = txRes.body.data.transactionId

        // User A (sender) can view detail
        const aView = await request(app)
            .get(`/api/v1/transactions/${txId}`)
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .expect(200)
        expect(aView.body.data.transaction._id.toString()).toBe(txId.toString())

        // Intruder cannot view detail
        await request(app)
            .get(`/api/v1/transactions/${txId}`)
            .set("Authorization", `Bearer ${cookieIntruder.split(";")[0].slice(6)}`)
            .expect(403)
    })

    test("admin role routes: protected against regular users", async () => {
        const regularUser = credentials("regular")
        const adminUser = credentials("admin-user", "admin")

        const regularCookie = await registerAndLogin(regularUser)
        const adminCookie = await registerAndLogin(adminUser)
        await User.updateOne({ email: adminUser.email }, { $set: { role: "admin" } })

        // Regular user denied
        await request(app)
            .get("/api/v1/admin/users")
            .set("Authorization", `Bearer ${regularCookie.split(";")[0].slice(6)}`)
            .expect(403)
        await request(app)
            .get("/api/v1/admin/accounts")
            .set("Authorization", `Bearer ${regularCookie.split(";")[0].slice(6)}`)
            .expect(403)
        await request(app)
            .get("/api/v1/admin/transactions/failed")
            .set("Authorization", `Bearer ${regularCookie.split(";")[0].slice(6)}`)
            .expect(403)

        // Admin granted
        const usersRes = await request(app)
            .get("/api/v1/admin/users")
            .set("Authorization", `Bearer ${adminCookie.split(";")[0].slice(6)}`)
            .expect(200)
        expect(usersRes.body.data.users.length).toBeGreaterThanOrEqual(2)

        const acctsRes = await request(app)
            .get("/api/v1/admin/accounts")
            .set("Authorization", `Bearer ${adminCookie.split(";")[0].slice(6)}`)
            .expect(200)
        expect(acctsRes.body.data.accounts).toBeDefined()

        const failedRes = await request(app)
            .get("/api/v1/admin/transactions/failed")
            .set("Authorization", `Bearer ${adminCookie.split(";")[0].slice(6)}`)
            .expect(200)
        expect(failedRes.body.data.failedTransfers).toBeDefined()
    })

    test("filters transaction history by status, type, and pagination", async () => {
        const userA = credentials("hist-a")
        const userB = credentials("hist-b")

        const cookieA = await registerAndLogin(userA)
        await registerAndLogin(userB)

        const userAModel = await User.findOne({ email: userA.email })
        const userBModel = await User.findOne({ email: userB.email })

        const acctA = await Account.create({ userId: userAModel._id, balance: 100000 })
        const acctB = await Account.create({ userId: userBModel._id, balance: 50000 })

        // Create 2 transfers and 1 deposit
        await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .send({ toAccountId: acctB._id.toString(), amount: 10000 })
            .expect(200)

        await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .send({ toAccountId: acctB._id.toString(), amount: 20000 })
            .expect(200)

        await request(app)
            .post(`/api/v1/accounts/${acctA._id}/deposit`)
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .send({ amount: 15000 })
            .expect(200)

        // Query history with filter type=TRANSFER
        const transferHistoryRes = await request(app)
            .get("/api/v1/transactions?type=TRANSFER&page=1&limit=10")
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .expect(200)

        expect(transferHistoryRes.body.success).toBe(true)
        expect(transferHistoryRes.body.data.transactions.length).toBe(2)
        expect(transferHistoryRes.body.data.pagination.total).toBe(2)

        // Query history with filter type=DEPOSIT
        const depositHistoryRes = await request(app)
            .get("/api/v1/transactions?type=DEPOSIT")
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .expect(200)

        expect(depositHistoryRes.body.data.transactions.length).toBe(1)
        expect(depositHistoryRes.body.data.transactions[0].type).toBe("DEPOSIT")

        // Query accounts via GET /api/v1/accounts/me
        const myAccountsRes = await request(app)
            .get("/api/v1/accounts/me")
            .set("Authorization", `Bearer ${cookieA.split(";")[0].slice(6)}`)
            .expect(200)

        expect(myAccountsRes.body.success).toBe(true)
        expect(myAccountsRes.body.data.accounts.length).toBe(1)
    })
})
