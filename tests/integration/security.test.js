const request = require("supertest")
const mongoose = require("mongoose")
const { MongoMemoryReplSet } = require("mongodb-memory-server")

let mockBlacklistStore = new Map()

jest.mock("../../src/config/redis", () => ({
    get: jest.fn((key) => mockBlacklistStore.get(key) || null),
    setEx: jest.fn((key, ttl, val) => {
        mockBlacklistStore.set(key, val)
        return "OK"
    }),
    isReady: true,
    ping: jest.fn().mockResolvedValue("PONG")
}))

const redisClient = require("../../src/config/redis")
const app = require("../../src/app")

let mongoServer

const credentials = (suffix = "sec") => ({
    name: `${suffix} User`,
    email: `${suffix}-${Date.now()}-${Math.random()}@example.com`,
    password: "SafePassword123!"
})

beforeAll(async () => {
    process.env.JWT_SECRET = "super-secret-jwt-key-for-tests-12345"
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    await mongoose.connect(mongoServer.getUri())
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()))
})

beforeEach(async () => {
    await Promise.all(
        Object.values(mongoose.models).map((model) => model.collection.deleteMany({}))
    )
    mockBlacklistStore.clear()
    redisClient.get.mockClear()
    redisClient.setEx.mockClear()
})

afterAll(async () => {
    await mongoose.disconnect()
    await mongoServer.stop()
})

describe("Security hardening", () => {
    test("sets secure cookie attributes: HttpOnly, SameSite=Strict, path", async () => {
        const user = credentials("cookie-sec")
        const res = await request(app).post("/api/auth/register").send(user).expect(201)

        const cookies = res.headers["set-cookie"]
        const tokenCookie = cookies.find((c) => c.startsWith("token="))
        const refreshCookie = cookies.find((c) => c.startsWith("refreshToken="))

        expect(tokenCookie).toMatch(/HttpOnly/i)
        expect(tokenCookie).toMatch(/SameSite=Strict/i)
        expect(tokenCookie).toMatch(/Path=\//i)

        expect(refreshCookie).toMatch(/HttpOnly/i)
        expect(refreshCookie).toMatch(/SameSite=Strict/i)
        expect(refreshCookie).toMatch(/Path=\/api\/auth/i)
    })

    test("rotates refresh token and issues new access token", async () => {
        const user = credentials("refresh-flow")
        const registerRes = await request(app).post("/api/auth/register").send(user).expect(201)

        const refreshCookie = registerRes.headers["set-cookie"].find((c) =>
            c.startsWith("refreshToken=")
        )

        const refreshRes = await request(app)
            .post("/api/auth/refresh")
            .set(
                "Cookie",
                refreshCookie.split(";")[0] + "; csrf-token=" + registerRes.body.data.csrfToken
            )
            .set("X-CSRF-Token", registerRes.body.data.csrfToken)
            .expect(200)

        expect(refreshRes.body.success).toBe(true)
        expect(refreshRes.body.data.accessToken).toBeDefined()

        const newCookies = refreshRes.headers["set-cookie"]
        expect(newCookies.find((c) => c.startsWith("token="))).toBeDefined()
        expect(newCookies.find((c) => c.startsWith("refreshToken="))).toBeDefined()
    })

    test("locks account after repeated failed login attempts", async () => {
        const user = credentials("lockout")
        await request(app).post("/api/auth/register").send(user).expect(201)

        // 5 consecutive wrong password attempts
        for (let i = 0; i < 5; i++) {
            await request(app)
                .post("/api/auth/login")
                .send({ email: user.email, password: "WrongPassword123!" })
                .expect(401)
        }

        // 6th attempt should be blocked with 423 Account Locked
        const lockedRes = await request(app)
            .post("/api/auth/login")
            .send({ email: user.email, password: "WrongPassword123!" })
            .expect(423)

        expect(lockedRes.body.success).toBe(false)
        expect(lockedRes.body.code).toBe("ACCOUNT_LOCKED")
    })

    test("handles malformed JSON request bodies safely with 400 error", async () => {
        const res = await request(app)
            .post("/api/auth/login")
            .set("Content-Type", "application/json")
            .send('{"email": "test@example.com", "password": bad_json}')
            .expect(400)

        expect(res.body.success).toBe(false)
        expect(res.body.code).toBe("INVALID_JSON")
        expect(res.body.message).toBe("Malformed JSON in request body")
    })
})
