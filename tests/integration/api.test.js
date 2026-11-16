const request = require("supertest")
const mongoose = require("mongoose")
const { MongoMemoryReplSet } = require("mongodb-memory-server")

jest.mock("../../src/config/redis", () => ({
    get: jest.fn(),
    setEx: jest.fn()
}))

const redisClient = require("../../src/config/redis")
const app = require("../../src/app")
const User = require("../../src/models/user")
const Account = require("../../src/models/account")
const Transaction = require("../../src/models/transaction")

let mongoServer
const blacklist = new Map()

const credentials = (suffix = "user") => ({
    name: `${suffix} User`,
    email: `${suffix}-${Date.now()}@example.com`,
    password: "SafePassword123!"
})

async function registerAndLogin(user) {
    await request(app).post("/api/auth/register").send(user).expect(201)
    const login = await request(app)
        .post("/api/auth/login")
        .send({ email: user.email, password: user.password })
        .expect(200)

    return login.headers["set-cookie"].find((cookie) => cookie.startsWith("token="))
}

async function createAccount(user, balance) {
    const storedUser = await User.findOne({ email: user.email })
    return Account.create({ userId: storedUser._id, balance })
}

beforeAll(async () => {
    process.env.JWT_SECRET = "integration-test-secret"
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    await mongoose.connect(mongoServer.getUri())
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()))

    redisClient.get.mockImplementation(async (key) => blacklist.get(key) || null)
    redisClient.setEx.mockImplementation(async (key, ttl, value) => {
        blacklist.set(key, value)
        return "OK"
    })
})

beforeEach(async () => {
    await Promise.all(
        Object.values(mongoose.models).map((model) => model.collection.deleteMany({}))
    )
    blacklist.clear()
    redisClient.get.mockClear()
    redisClient.setEx.mockClear()
})

afterAll(async () => {
    await mongoose.disconnect()
    await mongoServer.stop()
})

describe("authentication and Redis token blacklist", () => {
    test("registers a user and stores a bcrypt hash rather than the raw password", async () => {
        const user = credentials("register")
        const response = await request(app).post("/api/auth/register").send(user).expect(201)

        expect(response.body.success).toBe(true)
        expect(response.headers["set-cookie"][0]).toMatch(/token=.*HttpOnly/i)

        const savedUser = await User.findOne({ email: user.email }).select("+password")
        expect(savedUser.password).not.toBe(user.password)
        expect(await savedUser.comparepassword(user.password)).toBe(true)
    })

    test("rejects duplicate registration", async () => {
        const user = credentials("duplicate")
        await request(app).post("/api/auth/register").send(user).expect(201)
        const response = await request(app).post("/api/auth/register").send(user).expect(422)

        expect(response.body).toMatchObject({ success: false })
    })

    test("logs in with valid credentials and assigns an HTTP-only cookie", async () => {
        const user = credentials("login")
        const cookie = await registerAndLogin(user)

        expect(cookie).toMatch(/^token=/)
        expect(cookie).toMatch(/HttpOnly/i)
    })

    test.each([
        ["unknown email", { email: "missing@example.com", password: "SafePassword123!" }],
        ["wrong password", null]
    ])("rejects login with %s", async (description, payload) => {
        const user = credentials("invalid-login")
        await request(app).post("/api/auth/register").send(user).expect(201)
        const body = payload || { email: user.email, password: "WrongPassword123!" }

        await request(app).post("/api/auth/login").send(body).expect(401)
    })

    test("logs out, stores blacklist TTL, clears the cookie, and rejects the token", async () => {
        const user = credentials("logout")
        const tokenCookie = await registerAndLogin(user)
        const token = tokenCookie.split(";")[0].slice("token=".length)

        const logout = await request(app)
            .post("/api/auth/logout")
            .set("Authorization", `Bearer ${tokenCookie.split(";")[0].slice(6)}`)
            .expect(200)
        expect(logout.headers["set-cookie"][0]).toMatch(/token=;/i)
        expect(redisClient.setEx).toHaveBeenCalledWith(
            `blacklist:${require("../../src/utils/tokens").hashToken(token)}`,
            expect.any(Number),
            "true"
        )
        expect(redisClient.setEx.mock.calls[0][1]).toBeGreaterThan(0)

        await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${tokenCookie.split(";")[0].slice(6)}`)
            .send({ toAccountId: new mongoose.Types.ObjectId().toString(), amount: 1 })
            .expect(401)
    })
})

describe("ledger transfers and transaction boundaries", () => {
    async function fundedUsers() {
        const sender = credentials("sender")
        const receiver = credentials("receiver")
        const senderCookie = await registerAndLogin(sender)
        await request(app).post("/api/auth/register").send(receiver).expect(201)
        const senderAccount = await createAccount(sender, 1000)
        const receiverAccount = await createAccount(receiver, 100)
        return { sender, senderCookie, senderAccount, receiverAccount }
    }

    test("commits a valid $250 transfer and marks its ledger entry COMPLETED", async () => {
        const { senderCookie, senderAccount, receiverAccount } = await fundedUsers()
        const response = await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
            .send({ toAccountId: receiverAccount._id.toString(), amount: 250 })
            .expect(200)

        expect((await Account.findById(senderAccount._id)).balance).toBe(750)
        expect((await Account.findById(receiverAccount._id)).balance).toBe(350)
        expect((await Transaction.findById(response.body.data.transactionId)).status).toBe(
            "COMPLETED"
        )
    })

    test("prevents overdrafts, keeps balances unchanged, and preserves a FAILED audit record", async () => {
        const { senderCookie, senderAccount, receiverAccount } = await fundedUsers()
        await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
            .send({ toAccountId: receiverAccount._id.toString(), amount: 1001 })
            .expect(400)

        expect((await Account.findById(senderAccount._id)).balance).toBe(1000)
        expect((await Account.findById(receiverAccount._id)).balance).toBe(100)
        expect(
            await Transaction.exists({ fromAccount: senderAccount._id, status: "FAILED" })
        ).toBeTruthy()
    })

    test("prevents self-transfers", async () => {
        const { senderCookie, senderAccount } = await fundedUsers()
        await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
            .send({ toAccountId: senderAccount._id.toString(), amount: 1 })
            .expect(400)
    })

    test.each([0, -100])("rejects a non-positive transfer amount (%s)", async (amount) => {
        const { senderCookie, receiverAccount } = await fundedUsers()
        await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
            .send({ toAccountId: receiverAccount._id.toString(), amount })
            .expect(400)
    })

    test("returns 404 when the receiver account does not exist", async () => {
        const { senderCookie } = await fundedUsers()
        const response = await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
            .send({ toAccountId: new mongoose.Types.ObjectId().toString(), amount: 10 })
            .expect(404)

        expect(response.body).toMatchObject({
            success: false,
            status: 404,
            code: "NOT_FOUND",
            message: "Recipient account not found"
        })
    })

    test("preserves balances and records a FAILED audit entry when the recipient is absent", async () => {
        const { senderCookie, senderAccount, receiverAccount } = await fundedUsers()
        await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
            .send({ toAccountId: new mongoose.Types.ObjectId().toString(), amount: 10 })
            .expect(404)

        expect((await Account.findById(senderAccount._id)).balance).toBe(1000)
        expect((await Account.findById(receiverAccount._id)).balance).toBe(100)
        expect(
            await Transaction.exists({ fromAccount: senderAccount._id, status: "FAILED" })
        ).toBeTruthy()
    })
})

describe("error and security middleware", () => {
    test("returns validation errors before creating a user", async () => {
        const response = await request(app)
            .post("/api/auth/register")
            .send({ name: "A", email: "not-an-email", password: "short" })
            .expect(400)

        expect(response.body).toMatchObject({
            success: false,
            message: "Validation failed"
        })
        expect(response.body.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ field: "name" }),
                expect.objectContaining({ field: "email" }),
                expect.objectContaining({ field: "password" })
            ])
        )
    })

    test("rejects malformed transfer data after authentication", async () => {
        const { senderCookie } = await (async () => {
            const sender = credentials("validation-transfer")
            const cookie = await registerAndLogin(sender)
            return { senderCookie: cookie }
        })()

        const response = await request(app)
            .post("/api/v1/transactions/transfer")
            .set("Authorization", `Bearer ${senderCookie.split(";")[0].slice(6)}`)
            .send({ toAccountId: "not-an-object-id", amount: 12.5 })
            .expect(400)

        expect(response.body).toMatchObject({
            success: false,
            message: "Validation failed"
        })
        expect(response.body.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ field: "toAccountId" }),
                expect.objectContaining({ field: "amount" })
            ])
        )
    })

    test("denies protected access without a token cookie", async () => {
        await request(app)
            .post("/api/v1/transactions/transfer")
            .send({ toAccountId: new mongoose.Types.ObjectId().toString(), amount: 10 })
            .expect(401)
    })

    test("returns the validation middleware's uniform shape for an empty registration body", async () => {
        const response = await request(app).post("/api/auth/register").send({}).expect(400)

        expect(response.body).toMatchObject({
            success: false,
            message: "Validation failed"
        })
        expect(response.body.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ field: "name" }),
                expect.objectContaining({ field: "email" }),
                expect.objectContaining({ field: "password" })
            ])
        )
    })
})
