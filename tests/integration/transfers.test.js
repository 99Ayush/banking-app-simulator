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
const User = require("../../src/models/user")
const Account = require("../../src/models/account")
const Transaction = require("../../src/models/transaction")

let mongoServer

const credentials = (suffix = "p2") => ({
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

describe("Safe money transfers and idempotency", () => {
    test("generates a human-readable immutable transaction reference ID", async () => {
        const sender = credentials("ref-sender")
        const receiver = credentials("ref-receiver")
        const senderCookie = await registerAndLogin(sender)
        await registerAndLogin(receiver)

        await Account.create({
            userId: (await User.findOne({ email: sender.email }))._id,
            balance: 50000
        })
        const receiverAcct = await Account.create({
            userId: (await User.findOne({ email: receiver.email }))._id,
            balance: 10000
        })

        const res = await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
            .send({
                toAccountId: receiverAcct._id.toString(),
                amount: 15000
            })
            .expect(200)

        expect(res.body.success).toBe(true)
        expect(res.body.data.referenceId).toMatch(/^TXN-\d{8}-[A-F0-9]{16}$/)

        const savedTxn = await Transaction.findById(res.body.data.transactionId)
        expect(savedTxn.referenceId).toBe(res.body.data.referenceId)
    })

    test("returns original transfer result when an idempotent request is retried with header", async () => {
        const sender = credentials("idem-sender")
        const receiver = credentials("idem-receiver")
        const senderCookie = await registerAndLogin(sender)
        await registerAndLogin(receiver)

        const senderAcct = await Account.create({
            userId: (await User.findOne({ email: sender.email }))._id,
            balance: 100000
        })
        const receiverAcct = await Account.create({
            userId: (await User.findOne({ email: receiver.email }))._id,
            balance: 0
        })

        const idempotencyKey = "client-tx-uuid-12345"

        // First transfer attempt
        const res1 = await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
            .set("Idempotency-Key", idempotencyKey)
            .send({
                toAccountId: receiverAcct._id.toString(),
                amount: 25000
            })
            .expect(200)

        expect(res1.body.success).toBe(true)
        const txnId1 = res1.body.data.transactionId

        // Second retry with same idempotency key
        const res2 = await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
            .set("Idempotency-Key", idempotencyKey)
            .send({
                toAccountId: receiverAcct._id.toString(),
                amount: 25000
            })
            .expect(200)

        expect(res2.body.success).toBe(true)
        expect(res2.body.data.transactionId.toString()).toBe(txnId1.toString())
        expect(res2.body.isIdempotentReplay).toBe(true)

        // Verify balances were debited only ONCE
        const senderAfter = await Account.findById(senderAcct._id)
        const receiverAfter = await Account.findById(receiverAcct._id)
        expect(senderAfter.balance).toBe(75000)
        expect(receiverAfter.balance).toBe(25000)

        // Verify only 1 transaction document exists
        const count = await Transaction.countDocuments()
        expect(count).toBe(1)
    })

    test("records failed transfer with failure reason when sender has insufficient funds", async () => {
        const sender = credentials("insuf-sender")
        const receiver = credentials("insuf-receiver")
        const senderCookie = await registerAndLogin(sender)
        await registerAndLogin(receiver)

        const senderAcct = await Account.create({
            userId: (await User.findOne({ email: sender.email }))._id,
            balance: 5000
        })
        const receiverAcct = await Account.create({
            userId: (await User.findOne({ email: receiver.email }))._id,
            balance: 1000
        })

        const res = await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
            .send({
                toAccountId: receiverAcct._id.toString(),
                amount: 10000
            })
            .expect(400)

        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/Insufficient funds/i)

        // Ensure failure record exists with reason
        const failedTxn = await Transaction.findOne({
            fromAccount: senderAcct._id,
            status: "FAILED"
        })
        expect(failedTxn).toBeTruthy()
        expect(failedTxn.failureReason).toMatch(/Insufficient funds/i)

        // Ensure balances untouched
        const senderAfter = await Account.findById(senderAcct._id)
        const receiverAfter = await Account.findById(receiverAcct._id)
        expect(senderAfter.balance).toBe(5000)
        expect(receiverAfter.balance).toBe(1000)
    })

    test("concurrency test: competing transfers from same account prevent overdraft", async () => {
        const sender = credentials("race-sender")
        const receiver = credentials("race-receiver")
        const senderCookie = await registerAndLogin(sender)
        await registerAndLogin(receiver)

        // Starting balance is 10,000 paise
        const senderAcct = await Account.create({
            userId: (await User.findOne({ email: sender.email }))._id,
            balance: 10000
        })
        const receiverAcct = await Account.create({
            userId: (await User.findOne({ email: receiver.email }))._id,
            balance: 0
        })

        // Fire 4 parallel transfer requests of 4,000 paise each (total 16,000 > 10,000)
        const requests = [1, 2, 3, 4].map((i) =>
            request(app)
                .post("/api/v1/transactions/transfer")
                .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
                .set("Idempotency-Key", `race-key-${i}`)
                .send({
                    toAccountId: receiverAcct._id.toString(),
                    amount: 4000
                })
        )

        const results = await Promise.all(requests)

        const successes = results.filter((r) => r.status === 200)
        const failures = results.filter((r) => r.status === 400)

        // Exactly 2 transfers should succeed (2 * 4,000 = 8,000 <= 10,000)
        // The remaining 2 must fail due to insufficient funds
        expect(successes.length).toBe(2)
        expect(failures.length).toBe(2)

        const finalSender = await Account.findById(senderAcct._id)
        const finalReceiver = await Account.findById(receiverAcct._id)

        expect(finalSender.balance).toBe(2000) // 10000 - 8000
        expect(finalReceiver.balance).toBe(8000)
    })
})
