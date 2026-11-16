const crypto = require("crypto")
const { createClient } = require("redis")
const express = require("express")
const request = require("supertest")
const rateLimit = require("express-rate-limit")
const { RedisRateStore } = require("../../src/middleware/redis-rate-store")
const suite = process.env.TEST_REDIS_URL ? describe : describe.skip
suite("real Redis shared rate limits and revocation storage", () => {
    let first, second
    const prefix = "banking-test:" + crypto.randomUUID() + ":"
    const keys = []
    beforeAll(async () => {
        first = createClient({
            url: process.env.TEST_REDIS_URL,
            socket: { reconnectStrategy: false },
            disableOfflineQueue: true
        })
        second = createClient({
            url: process.env.TEST_REDIS_URL,
            socket: { reconnectStrategy: false },
            disableOfflineQueue: true
        })
        first.on("error", () => {})
        second.on("error", () => {})
        await Promise.all([first.connect(), second.connect()])
    })
    afterAll(async () => {
        if (first.isReady && keys.length) await first.del(keys)
        await Promise.allSettled([first.quit(), second.quit()])
    })
    test("Lua increments are atomic across separate Redis clients and expire", async () => {
        const a = new RedisRateStore(first, prefix + "atomic:"),
            b = new RedisRateStore(second, prefix + "atomic:")
        a.init({ windowMs: 1000 })
        b.init({ windowMs: 1000 })
        keys.push(a.key("one-user"))
        const values = await Promise.all(
            Array.from({ length: 100 }, (_, i) => (i % 2 ? a : b).increment("one-user"))
        )
        expect(new Set(values.map((v) => v.totalHits)).size).toBe(100)
        expect(await first.pTTL(a.key("one-user"))).toBeGreaterThan(0)
        await new Promise((resolve) => setTimeout(resolve, 1100))
        expect(await first.get(a.key("one-user"))).toBeNull()
    })
    test("two API instances enforce one shared limit", async () => {
        const build = (client) => {
            const app = express(),
                store = new RedisRateStore(client, prefix + "shared:")
            app.use(
                rateLimit({
                    store,
                    windowMs: 10000,
                    max: 2,
                    standardHeaders: true,
                    legacyHeaders: false
                })
            )
            app.get("/", (req, res) => res.json({ success: true }))
            return app
        }
        const a = build(first),
            b = build(second)
        await request(a).get("/").expect(200)
        await request(b).get("/").expect(200)
        await request(a).get("/").expect(429)
        const store = new RedisRateStore(first, prefix + "shared:")
        const all = await first.keys(prefix + "shared:*")
        keys.push(...all)
        expect(typeof store.increment).toBe("function")
    })
    test("hashed revocation keys carry TTL and contain no raw credentials", async () => {
        const token = "unique-test-token-" + crypto.randomUUID()
        const key = prefix + "blacklist:" + crypto.createHash("sha256").update(token).digest("hex")
        keys.push(key)
        await first.setEx(key, 2, "true")
        expect(await second.get(key)).toBe("true")
        expect(await second.ttl(key)).toBeGreaterThan(0)
        expect(key).not.toContain(token)
    })
    test("an unavailable Redis client rejects rate-limit checks", async () => {
        const unavailable = createClient({
            url: process.env.TEST_REDIS_URL,
            disableOfflineQueue: true
        })
        const store = new RedisRateStore(unavailable, prefix + "offline:")
        store.init({ windowMs: 1000 })
        await expect(store.increment("one-user")).rejects.toThrow()
    })
})
