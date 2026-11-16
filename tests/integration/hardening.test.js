const request = require("supertest")
const crypto = require("crypto")
const mongoose = require("mongoose")
const { MongoMemoryReplSet } = require("mongodb-memory-server")
jest.mock("../../src/config/redis", () => ({
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue("OK"),
    isReady: true,
    ping: jest.fn().mockResolvedValue("PONG")
}))
const redis = require("../../src/config/redis")
const app = require("../../src/app")
const User = require("../../src/models/user")
const Account = require("../../src/models/account")
const Transaction = require("../../src/models/transaction")
const Journal = require("../../src/models/journal")
const Session = require("../../src/models/session")
const { reconcile } = require("../../src/services/reconciliation")
const { dayKey } = require("../../src/utils/amount")
let server
async function user(suffix = crypto.randomUUID()) {
    const response = await request(app)
        .post("/api/auth/register")
        .send({
            name: "Regression User",
            email: suffix + "@example.com",
            password: "SafePassword123!"
        })
        .expect(201)
    return {
        ...response.body.data,
        cookies: response.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ")
    }
}
async function account(owner, balance = 0, extra = {}) {
    const created = await Account.create({
        userId: owner.user.id,
        balance: 0,
        ledgerInitialized: true,
        ...extra
    })
    if (balance)
        await request(app)
            .post("/api/v1/accounts/" + created._id + "/deposit")
            .set("Authorization", "Bearer " + owner.accessToken)
            .send({ amount: balance })
            .expect(200)
    return created
}
const transfer = (owner, sender, receiver, amount, key) => {
    const req = request(app)
        .post("/api/v1/transactions/transfer")
        .set("Authorization", "Bearer " + owner.accessToken)
    if (key) req.set("Idempotency-Key", key)
    return req.send({
        senderAccountId: sender._id.toString(),
        toAccountId: receiver._id.toString(),
        amount
    })
}
beforeAll(async () => {
    process.env.JWT_SECRET = "regression-access-secret-at-least-32-characters"
    process.env.JWT_REFRESH_SECRET = "regression-refresh-secret-at-least-32-characters"
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    await mongoose.connect(server.getUri())
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()))
})
beforeEach(async () => {
    await Promise.all(
        Object.values(mongoose.models).map((model) => model.collection.deleteMany({}))
    )
    redis.get.mockReset().mockResolvedValue(null)
    redis.setEx.mockReset().mockResolvedValue("OK")
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => {
    await mongoose.disconnect()
    await server.stop()
})
test("public registration rejects administrator privilege injection", async () => {
    await request(app)
        .post("/api/auth/register")
        .send({
            name: "Admin",
            email: "admin@example.com",
            password: "SafePassword123!",
            role: "admin"
        })
        .expect(400)
    expect(await User.countDocuments()).toBe(0)
})

test("refresh rejects unknown fields without consuming the original token", async () => {
    const owner = await user()
    await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: owner.refreshToken, role: "admin" })
        .expect(400)
    await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: owner.refreshToken })
        .expect(200)
})
test("refresh tokens rotate within the same second and reuse revokes every session", async () => {
    const owner = await user()
    const refreshed = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: owner.refreshToken })
        .expect(200)
    expect(refreshed.body.data.refreshToken).not.toBe(owner.refreshToken)
    await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: owner.refreshToken })
        .expect(401)
    await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: owner.refreshToken })
        .expect(401)
    await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: refreshed.body.data.refreshToken })
        .expect(401)
    await request(app)
        .get("/api/v1/accounts/me")
        .set("Authorization", "Bearer " + refreshed.body.data.accessToken)
        .expect(401)
})
test("logout revokes refresh sessions and stores only a token hash", async () => {
    const owner = await user()
    await request(app)
        .post("/api/auth/logout")
        .set("Authorization", "Bearer " + owner.accessToken)
        .expect(200)
    expect(redis.setEx).toHaveBeenCalledTimes(1)
    expect(redis.setEx.mock.calls[0][0]).toMatch(/^blacklist:[a-f0-9]{64}$/)
    expect(await Session.countDocuments({ revokedAt: null })).toBe(0)
    await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: owner.refreshToken })
        .expect(401)
})
test("refresh tokens cannot authenticate access routes even with a shared test secret", async () => {
    const saved = process.env.JWT_REFRESH_SECRET
    process.env.JWT_REFRESH_SECRET = process.env.JWT_SECRET
    try {
        const owner = await user()
        await request(app)
            .get("/api/v1/accounts/me")
            .set("Authorization", "Bearer " + owner.refreshToken)
            .expect(401)
        await request(app)
            .post("/api/auth/refresh")
            .send({ refreshToken: owner.accessToken })
            .expect(401)
    } finally {
        process.env.JWT_REFRESH_SECRET = saved
    }
})
test("Redis failure fails authentication closed", async () => {
    const owner = await user()
    redis.get.mockRejectedValue(new Error("Redis unavailable"))
    await request(app)
        .get("/api/v1/accounts/me")
        .set("Authorization", "Bearer " + owner.accessToken)
        .expect(503)
})
test("cookie requests require the issued signed CSRF token in test mode too", async () => {
    const owner = await user()
    await request(app).post("/api/v1/accounts").set("Cookie", owner.cookies).send({}).expect(403)
    await request(app)
        .post("/api/v1/accounts")
        .set("Cookie", owner.cookies)
        .set("X-CSRF-Token", "invented")
        .send({})
        .expect(403)
    await request(app)
        .post("/api/v1/accounts")
        .set("Cookie", owner.cookies)
        .set("X-CSRF-Token", owner.csrfToken)
        .send({})
        .expect(201)
    await request(app).post("/api/auth/refresh").set("Cookie", owner.cookies).expect(403)
    await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", owner.cookies)
        .set("X-CSRF-Token", owner.csrfToken)
        .expect(200)
})
test("a malformed Authorization header cannot bypass cookie CSRF checks", async () => {
    const owner = await user()
    await request(app)
        .post("/api/v1/accounts")
        .set("Cookie", owner.cookies)
        .set("Authorization", "anything")
        .send({})
        .expect(401)
})
test("repeated unkeyed transfers and withdrawals work with real unique indexes", async () => {
    const alice = await user(),
        bob = await user()
    const sender = await account(alice, 10000),
        receiver = await account(bob)
    for (let i = 0; i < 3; i++) {
        await transfer(alice, sender, receiver, 100).expect(200)
        await request(app)
            .post("/api/v1/accounts/" + sender._id + "/withdraw")
            .set("Authorization", "Bearer " + alice.accessToken)
            .send({ amount: 100 })
            .expect(200)
    }
    expect((await Account.findById(sender._id)).balance).toBe(9400)
    expect((await reconcile()).consistent).toBe(true)
})
test("simultaneous identical keys debit only once and reject changed payloads", async () => {
    const alice = await user(),
        bob = await user()
    const sender = await account(alice, 10000),
        receiver = await account(bob)
    const results = await Promise.all(
        Array.from({ length: 6 }, () =>
            transfer(alice, sender, receiver, 1000, "shared-payment-key")
        )
    )
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(200))
    expect(new Set(results.map((r) => r.body.data.transactionId)).size).toBe(1)
    expect((await Account.findById(sender._id)).balance).toBe(9000)
    expect((await Account.findById(receiver._id)).balance).toBe(1000)
    await transfer(alice, sender, receiver, 2000, "shared-payment-key").expect(409)
    expect((await reconcile()).consistent).toBe(true)
})
test("header keys are validated and cannot conflict with body keys", async () => {
    const alice = await user(),
        bob = await user()
    const sender = await account(alice, 10000),
        receiver = await account(bob)
    await transfer(alice, sender, receiver, 100, "x").expect(400)
    await transfer(alice, sender, receiver, 100, "header-key")
        .send({ idempotencyKey: "body-key" })
        .expect(400)
    expect(await Transaction.countDocuments({ type: "TRANSFER" })).toBe(0)
})
test("daily limits remain atomic under concurrent different payments", async () => {
    const alice = await user(),
        bob = await user()
    const sender = await account(alice, 10000, { dailyTransferLimit: 1000 }),
        receiver = await account(bob)
    const results = await Promise.all([
        transfer(alice, sender, receiver, 600, "daily-one"),
        transfer(alice, sender, receiver, 600, "daily-two")
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 400])
    expect((await Account.findById(sender._id)).dailyTransferred).toBe(600)
    expect((await reconcile()).consistent).toBe(true)
})
test("withdrawals do not consume transfer allowance and day boundaries reset it", async () => {
    const alice = await user(),
        bob = await user()
    const sender = await account(alice, 10000, { dailyTransferLimit: 1000 }),
        receiver = await account(bob)
    await request(app)
        .post("/api/v1/accounts/" + sender._id + "/withdraw")
        .set("Authorization", "Bearer " + alice.accessToken)
        .send({ amount: 2000 })
        .expect(200)
    await transfer(alice, sender, receiver, 1000).expect(200)
    expect((await Account.findById(sender._id)).transferDay).toBe(dayKey())
    expect(dayKey(new Date("2026-11-15T18:29:59Z"))).toBe("2026-11-15")
    expect(dayKey(new Date("2026-11-15T18:30:00Z"))).toBe("2026-11-16")
})
test.each(["FROZEN", "CLOSED"])("transfers reject %s senders and recipients", async (status) => {
    const alice = await user(),
        bob = await user()
    const sender = await account(alice, 10000),
        receiver = await account(bob)
    await Account.updateOne({ _id: receiver._id }, { $set: { status } })
    await transfer(alice, sender, receiver, 100).expect(400)
    await Account.updateOne({ _id: receiver._id }, { $set: { status: "ACTIVE" } })
    await Account.updateOne({ _id: sender._id }, { $set: { status } })
    await transfer(alice, sender, receiver, 100).expect(400)
    expect((await Account.findById(sender._id)).balance).toBe(10000)
})
test("multiple accounts require explicit owned sender selection", async () => {
    const alice = await user(),
        bob = await user()
    const first = await account(alice, 1000),
        second = await account(alice, 2000),
        receiver = await account(bob)
    await request(app)
        .post("/api/v1/transactions/transfer")
        .set("Authorization", "Bearer " + alice.accessToken)
        .send({ toAccountId: receiver._id.toString(), amount: 100 })
        .expect(400)
    await transfer(alice, second, receiver, 100).expect(200)
    await transfer(bob, first, receiver, 100).expect(404)
    expect((await Account.findById(first._id)).balance).toBe(1000)
})
test("an uncertain successful commit retries the commit without moving money twice", async () => {
    const alice = await user(),
        bob = await user()
    const sender = await account(alice, 10000),
        receiver = await account(bob)
    const prototype = mongoose.mongo.ClientSession.prototype
    const original = prototype.commitTransaction
    jest.spyOn(prototype, "commitTransaction").mockImplementationOnce(async function () {
        await original.call(this)
        const error = new mongoose.mongo.MongoServerError({
            message: "lost commit acknowledgement"
        })
        error.addErrorLabel("UnknownTransactionCommitResult")
        throw error
    })
    await transfer(alice, sender, receiver, 1000, "uncertain-commit").expect(200)
    expect((await Account.findById(sender._id)).balance).toBe(9000)
    expect(await Journal.countDocuments({ description: "TRANSFER" })).toBe(1)
    expect((await reconcile()).consistent).toBe(true)
})
test("durable pending operations can recover after a worker restart", async () => {
    const alice = await user(),
        bob = await user()
    const sender = await account(alice, 10000),
        receiver = await account(bob)
    const run = require("../../src/utils/database-transaction")
    // Simulate a crash before money moves by creating its durable request record.
    const fingerprint = crypto
        .createHash("sha256")
        .update(
            JSON.stringify({
                type: "TRANSFER",
                requestAccount: sender._id.toString(),
                toAccount: receiver._id.toString(),
                amount: 1000
            })
        )
        .digest("hex")
    const pending = await Transaction.create({
        initiatedBy: alice.user.id,
        requestAccount: sender._id,
        fromAccount: sender._id,
        toAccount: receiver._id,
        amount: 1000,
        type: "TRANSFER",
        idempotencyKey: "restart-key",
        requestFingerprint: fingerprint
    })
    expect(typeof run.runTransaction).toBe("function")
    await request(app)
        .post("/api/v1/transactions/" + pending._id + "/retry")
        .set("Authorization", "Bearer " + alice.accessToken)
        .expect(200)
    await transfer(alice, sender, receiver, 1000, "restart-key").expect(200)
    expect((await Account.findById(sender._id)).balance).toBe(9000)
    expect((await reconcile()).consistent).toBe(true)
})
test("journal writes balance and updates/deletions are rejected", async () => {
    const owner = await user(),
        funded = await account(owner, 1000)
    const entry = await Journal.findOne()
    await expect(
        Journal.updateOne({ _id: entry._id }, { $set: { description: "tampered" } })
    ).rejects.toThrow("append-only")
    await expect(Journal.deleteOne({ _id: entry._id })).rejects.toThrow("append-only")
    await expect(entry.deleteOne()).rejects.toThrow("append-only")
    await expect(
        Journal.create({
            operationId: "invalid",
            description: "INVALID",
            postings: [
                {
                    ledgerAccount: "customer:" + funded._id,
                    kind: "LIABILITY",
                    normalSide: "CREDIT",
                    side: "CREDIT",
                    amount: 1
                }
            ]
        })
    ).rejects.toThrow()
    expect((await reconcile()).consistent).toBe(true)
    await Account.updateOne({ _id: funded._id }, { $inc: { balance: 1 } })
    expect((await reconcile()).issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "BALANCE_MISMATCH" })])
    )
})
test("production blocks self funding while administrators can fund idempotently", async () => {
    const owner = await user(),
        admin = await user(),
        target = await account(owner)
    await User.updateOne({ _id: admin.user.id }, { $set: { role: "admin" } })
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = "production"
    try {
        await request(app)
            .post("/api/v1/accounts/" + target._id + "/deposit")
            .set("Authorization", "Bearer " + owner.accessToken)
            .send({ amount: 100 })
            .expect(403)
        const fund = () =>
            request(app)
                .post("/api/v1/admin/accounts/" + target._id + "/funding")
                .set("Authorization", "Bearer " + admin.accessToken)
                .set("Idempotency-Key", "admin-funding-key")
                .send({ amount: 1000 })
        await fund().expect(200)
        await fund().expect(200)
        expect((await Account.findById(target._id)).balance).toBe(1000)
        await request(app).get("/metrics").expect(401)
        await request(app).get("/api/docs.json").expect(401)
    } finally {
        process.env.NODE_ENV = previous
    }
})
test("administrator status transitions reject closing funded accounts and reopening closed ones", async () => {
    const admin = await user(),
        target = await account(admin, 100)
    await User.updateOne({ _id: admin.user.id }, { $set: { role: "admin" } })
    const change = (status) =>
        request(app)
            .patch("/api/v1/admin/accounts/" + target._id + "/status")
            .set("Authorization", "Bearer " + admin.accessToken)
            .send({ status })
    await change("CLOSED").expect(400)
    await change("FROZEN").expect(200)
    await change("ACTIVE").expect(200)
    await request(app)
        .post("/api/v1/accounts/" + target._id + "/withdraw")
        .set("Authorization", "Bearer " + admin.accessToken)
        .send({ amount: 100 })
        .expect(200)
    await change("CLOSED").expect(200)
    await change("ACTIVE").expect(400)
})
test("history rejects invalid pagination, filters, dates, and large money amounts", async () => {
    const owner = await user(),
        target = await account(owner)
    for (const query of [
        "page=abc",
        "page=0",
        "page=" + "9".repeat(100),
        "limit=0",
        "limit=-1",
        "status=INVENTED",
        "startDate=invalid"
    ]) {
        await request(app)
            .get("/api/v1/transactions?" + query)
            .set("Authorization", "Bearer " + owner.accessToken)
            .expect(400)
    }
    await request(app)
        .post("/api/v1/accounts/" + target._id + "/deposit")
        .set("Authorization", "Bearer " + owner.accessToken)
        .send({ amount: Number.MAX_SAFE_INTEGER })
        .expect(400)
})

test("journal pagination and date filters are applied and unsupported filters are rejected", async () => {
    const owner = await user(),
        target = await account(owner, 1000)
    const read = (query) =>
        request(app)
            .get("/api/v1/accounts/" + target._id + "/ledger?" + query)
            .set("Authorization", "Bearer " + owner.accessToken)
    const response = await read("page=1&limit=1&sort=asc").expect(200)
    expect(response.body.data.pagination).toEqual({ total: 1, page: 1, limit: 1, totalPages: 1 })
    expect(response.body.data.journals).toHaveLength(1)
    const future = new Date(Date.now() + 86400000).toISOString()
    expect(
        (await read("startDate=" + encodeURIComponent(future)).expect(200)).body.data.journals
    ).toHaveLength(0)
    await read("status=COMPLETED").expect(400)
    await request(app)
        .get("/api/v1/accounts/balance?accountId=invalid")
        .set("Authorization", "Bearer " + owner.accessToken)
        .expect(400)
})

test("readiness checks real dependency responses and rejects unavailable Redis", async () => {
    await request(app).get("/ready").expect(200)
    redis.ping.mockRejectedValueOnce(new Error("Redis unavailable"))
    await request(app).get("/ready").expect(503)
})

test("seed preserves unrelated history and remains idempotent", async () => {
    const owner = await user(),
        existing = await account(owner, 1000)
    const previousUri = process.env.MONGO_URI
    process.env.MONGO_URI = server.getUri()
    jest.spyOn(console, "log").mockImplementation(() => {})
    try {
        const { seedDatabase } = require("../../scripts/seed")
        await seedDatabase()
        await seedDatabase()
        expect((await Account.findById(existing._id)).balance).toBe(1000)
        expect(await Transaction.countDocuments()).toBe(4)
        expect((await reconcile()).consistent).toBe(true)
    } finally {
        if (previousUri === undefined) delete process.env.MONGO_URI
        else process.env.MONGO_URI = previousUri
    }
})

test("seed resumes after losing a funding acknowledgement without adding funds twice", async () => {
    const previousUri = process.env.MONGO_URI
    process.env.MONGO_URI = server.getUri()
    jest.spyOn(console, "log").mockImplementation(() => {})
    const service = require("../../src/services/account")
    const original = service.deposit.bind(service)
    jest.spyOn(service, "deposit").mockImplementationOnce(async (...args) => {
        await original(...args)
        throw new Error("lost funding acknowledgement")
    })
    try {
        const { seedDatabase } = require("../../scripts/seed")
        await expect(seedDatabase()).rejects.toThrow("lost funding acknowledgement")
        await seedDatabase()
        await seedDatabase()
        expect(await Transaction.countDocuments()).toBe(3)
        expect((await Account.findOne({ accountNumber: "ACC100000001" })).balance).toBe(100000)
        expect(await Account.countDocuments({ seedFundingPending: true })).toBe(0)
        expect((await reconcile()).consistent).toBe(true)
    } finally {
        if (previousUri === undefined) delete process.env.MONGO_URI
        else process.env.MONGO_URI = previousUri
    }
})

test("the Postman backend walkthrough completes twice with replay and reconciliation checks", async () => {
    const vm = require("node:vm")
    const collection = require("../../postman-collection.json")
    const variables = new Map(collection.variable.map(({ key, value }) => [key, value]))
    const replaceIn = (value) =>
        value.replace(/\{\{([^}]+)\}\}/g, (_match, key) =>
            key === "$guid" ? crypto.randomUUID() : variables.get(key) || ""
        )
    const previousUri = process.env.MONGO_URI
    process.env.MONGO_URI = server.getUri()
    jest.spyOn(console, "log").mockImplementation(() => {})
    try {
        await require("../../scripts/seed").seedDatabase()
        for (let run = 0; run < 2; run++) {
            for (const item of collection.item.find(
                (folder) => folder.name === "Backend walkthrough"
            ).item) {
                expect(item.protocolProfileBehavior.disableCookies).toBe(true)
                let response
                const pm = {
                    collectionVariables: {
                        get: (key) => variables.get(key),
                        set: (key, value) => variables.set(key, value)
                    },
                    variables: { replaceIn },
                    response: {
                        json: () => response.body,
                        to: { have: { status: (code) => expect(response.status).toBe(code) } }
                    },
                    expect: (value) => ({
                        to: { eql: (expected) => expect(value).toEqual(expected) }
                    }),
                    test: (_name, callback) => callback()
                }
                const execute = (event) => vm.runInNewContext(event.script.exec.join("\n"), { pm })
                for (const event of item.event || [])
                    if (event.listen === "prerequest") execute(event)
                const url = new URL(replaceIn(item.request.url.raw))
                let apiRequest = request(app)[item.request.method.toLowerCase()](
                    url.pathname + url.search
                )
                for (const header of item.request.header || [])
                    if (!header.disabled)
                        apiRequest = apiRequest.set(header.key, replaceIn(header.value))
                if (item.request.body?.raw)
                    apiRequest = apiRequest.send(JSON.parse(replaceIn(item.request.body.raw)))
                response = await apiRequest
                for (const event of item.event || []) if (event.listen === "test") execute(event)
            }
        }
        expect(await Transaction.countDocuments({ type: "TRANSFER" })).toBe(2)
        expect((await reconcile()).consistent).toBe(true)
    } finally {
        if (previousUri === undefined) delete process.env.MONGO_URI
        else process.env.MONGO_URI = previousUri
    }
})

test("legacy migration checkpoints balances, replaces the sparse index, and is idempotent", async () => {
    const owner = await user()
    const legacyAccount = await Account.create({ userId: owner.user.id, balance: 500 })
    await Transaction.create({
        toAccount: legacyAccount._id,
        type: "DEPOSIT",
        amount: 500,
        status: "COMPLETED"
    })
    await Transaction.collection.createIndex(
        { fromAccount: 1, idempotencyKey: 1 },
        { sparse: true, unique: true }
    )
    const previousUri = process.env.MONGO_URI
    process.env.MONGO_URI = server.getUri()
    jest.spyOn(console, "log").mockImplementation(() => {})
    try {
        const { migrate } = require("../../scripts/migrate")
        await migrate(false)
        expect(await Journal.countDocuments()).toBe(0)
        await migrate(true)
        await migrate(true)
        expect((await Account.findById(legacyAccount._id)).balance).toBe(500)
        expect(await Journal.countDocuments()).toBe(1)
        expect(
            (await Transaction.collection.indexes()).some(
                (index) => index.key.fromAccount && index.key.idempotencyKey
            )
        ).toBe(false)
        expect((await reconcile()).consistent).toBe(true)
    } finally {
        if (previousUri === undefined) delete process.env.MONGO_URI
        else process.env.MONGO_URI = previousUri
    }
})
