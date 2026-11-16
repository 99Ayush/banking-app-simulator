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

let mongoServer

beforeAll(async () => {
    process.env.JWT_SECRET = "integration-test-secret"
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    await mongoose.connect(mongoServer.getUri())
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()))
})

afterAll(async () => {
    await mongoose.disconnect()
    await mongoServer.stop()
})

describe("Engineering quality and observability", () => {
    test("GET /health returns 200 with service health and uptime", async () => {
        const res = await request(app).get("/health").expect(200)
        expect(res.body.status).toBe("healthy")
        expect(typeof res.body.uptime).toBe("number")
    })

    test("GET /ready returns 200 when MongoDB and Redis are ready", async () => {
        const res = await request(app).get("/ready").expect(200)
        expect(res.body.status).toBe("ready")
        expect(res.body.services.database).toBe("connected")
    })

    test("GET /metrics returns latency, status codes, and counters", async () => {
        const res = await request(app).get("/metrics").expect(200)
        expect(res.body.success).toBe(true)
        expect(res.body.metrics.totalRequests).toBeGreaterThanOrEqual(1)
        expect(typeof res.body.metrics.avgLatencyMs).toBe("number")
    })

    test("GET /api/docs.json serves valid OpenAPI 3.0 specification", async () => {
        const res = await request(app).get("/api/docs.json").expect(200)
        expect(res.body.openapi).toBe("3.0.3")
        expect(res.body.info.title).toBe("Banking Backend API")
        expect(res.body.paths["/api/v1/transactions/transfer"]).toBeDefined()
    })
})
