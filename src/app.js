const express = require("express")
const cookieParser = require("cookie-parser")
const helmet = require("helmet")
const cors = require("cors")
const mongoose = require("mongoose")

const redisClient = require("./config/redis")
const { requestIdMiddleware, metricsMiddleware, getMetrics } = require("./utils/logger")
const { errorHandler } = require("./middleware/error")
const { csrfProtection } = require("./middleware/auth")
const { apiLimiter } = require("./middleware/rate-limit")
const { setupSwagger } = require("./openapi/document")

const authRouter = require("./routes/auth")
const accountRouter = require("./routes/account")
const transactionRouter = require("./routes/transaction")
const beneficiaryRouter = require("./routes/beneficiary")
const adminRouter = require("./routes/admin")

const app = express()
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 0))

// Behind a proxy every request carries X-Forwarded-For. With TRUST_PROXY_HOPS=0 the
// app sees the proxy address instead of the client, so every caller shares one
// rate-limit bucket. Surface that once instead of failing silently in production.
if (Number(process.env.TRUST_PROXY_HOPS || 0) === 0) {
    let warnedSharedIp = false
    app.use((req, res, next) => {
        if (!warnedSharedIp && req.headers["x-forwarded-for"]) {
            warnedSharedIp = true
            console.warn(
                "X-Forwarded-For received with TRUST_PROXY_HOPS=0: client addresses and rate limits are shared. Set TRUST_PROXY_HOPS to the number of proxies in front of this API."
            )
        }
        next()
    })
}

// Track rejected origins and malformed requests as well as successful API calls.
app.use(requestIdMiddleware)
app.use(metricsMiddleware)

// Helmet security headers
app.use(
    helmet({
        contentSecurityPolicy: process.env.NODE_ENV === "production",
        crossOriginEmbedderPolicy: false
    })
)

// CORS configuration restricted to approved origins
// CLIENT_URL accepts a comma-separated list, so preview deployments and a local
// origin can be allowed without editing code.
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
if (process.env.NODE_ENV !== "production" && !allowedOrigins.includes("http://localhost:3000"))
    allowedOrigins.push("http://localhost:3000")
app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                return callback(null, true)
            }
            return callback(
                new (require("./errors/app-error").ForbiddenError)(
                    "Origin not allowed",
                    "CORS_ERROR"
                )
            )
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "Idempotency-Key",
            "X-Request-Id",
            "X-CSRF-Token"
        ]
    })
)

// Body size limit (10kb) and json parsing
app.use(express.json({ limit: "10kb" }))
app.use(cookieParser())

// General API rate limiter (relaxed during testing)
app.use("/api", apiLimiter)

// CSRF protection on state-changing requests using cookie auth
app.use(csrfProtection)

// Health & Readiness Endpoints
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    })
})

app.get("/ready", async (req, res) => {
    const checks = await Promise.allSettled([
        mongoose.connection.readyState === 1
            ? mongoose.connection.db.admin().command({ ping: 1 }, { timeoutMS: 5000 })
            : Promise.reject(new Error("Database unavailable")),
        typeof redisClient.ping === "function"
            ? require("./utils/redis-command").redisCommand(redisClient, "ping")
            : Promise.reject(new Error("Redis unavailable"))
    ])
    const mongoReady = checks[0].status === "fulfilled" && checks[0].value.ok === 1
    const redisReady = checks[1].status === "fulfilled" && checks[1].value === "PONG"

    const isReady = mongoReady && redisReady
    const statusCode = isReady ? 200 : 503

    res.status(statusCode).json({
        status: isReady ? "ready" : "unready",
        services: {
            database: mongoReady ? "connected" : "disconnected",
            redis: redisReady ? "connected" : "disconnected"
        }
    })
})

// Error monitoring and basic metrics
app.get(
    "/metrics",
    (req, res, next) => {
        if (process.env.NODE_ENV === "production")
            return require("./middleware/auth").protectRoute(req, res, next)
        next()
    },
    (req, res, next) => {
        if (process.env.NODE_ENV === "production")
            return require("./middleware/auth").requireRole("admin")(req, res, next)
        next()
    },
    (req, res) => {
        res.status(200).json({
            success: true,
            metrics: getMetrics()
        })
    }
)

// Swagger UI documentation
setupSwagger(app)

// API Routes
app.use("/api/auth", authRouter)
app.use("/api/v1/accounts", accountRouter)
app.use("/api/v1/transactions", transactionRouter)
app.use("/api/v1/beneficiaries", beneficiaryRouter)
app.use("/api/v1/admin", adminRouter)

// Centralized error handler
app.use((req, res, next) =>
    next(new (require("./errors/app-error").NotFoundError)("Endpoint not found"))
)
app.use(require("./middleware/rate-limit").rateLimitError)
app.use(errorHandler)

module.exports = app
