const rateLimit = require("express-rate-limit")
const redis = require("../config/redis")
const { RedisRateStore } = require("./redis-rate-store")
const { AppError } = require("../errors/app-error")
function limiter(name, windowMs, max, perUser = false) {
    return rateLimit({
        windowMs,
        max: process.env.NODE_ENV === "test" ? 10000 : max,
        store:
            process.env.NODE_ENV === "test"
                ? undefined
                : new RedisRateStore(redis, "rate:" + name + ":"),
        ...(perUser ? { keyGenerator: (req) => req.user._id.toString() } : {}),
        standardHeaders: true,
        legacyHeaders: false,
        passOnStoreError: false,
        message: {
            success: false,
            status: 429,
            code: "TOO_MANY_REQUESTS",
            message: "Rate limit exceeded"
        }
    })
}
const authLimiter = limiter("auth", 900000, 20)
const transferLimiter = limiter("transfer", 60000, 30, true)
const apiLimiter = limiter("api", 900000, 500)
function rateLimitError(err, req, res, next) {
    if (/redis|connect|socket/i.test(err.message || ""))
        return next(new AppError("Rate limit storage unavailable", 503, "SERVICE_UNAVAILABLE"))
    next(err)
}
module.exports = { authLimiter, transferLimiter, apiLimiter, rateLimitError }
