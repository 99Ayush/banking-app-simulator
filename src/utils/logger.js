const crypto = require("crypto")

function sanitize(obj) {
    if (!obj || typeof obj !== "object") return obj
    const copy = Array.isArray(obj) ? [...obj] : { ...obj }

    const sensitiveFields = ["password", "token", "refreshToken", "authorization", "secret"]
    for (const key of Object.keys(copy)) {
        if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
            copy[key] = "[REDACTED]"
        } else if (typeof copy[key] === "object") {
            copy[key] = sanitize(copy[key])
        }
    }
    return copy
}

function requestIdMiddleware(req, res, next) {
    const supplied = req.headers["x-request-id"]
    req.id =
        typeof supplied === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(supplied)
            ? supplied
            : crypto.randomUUID()
    res.setHeader("X-Request-Id", req.id)
    next()
}

const metricsState = {
    totalRequests: 0,
    statusCodes: {},
    failedTransfers: 0,
    totalLatencyMs: 0,
    requestCountForLatency: 0,
    recentLatencies: []
}

function metricsMiddleware(req, res, next) {
    const start = Date.now()
    metricsState.totalRequests++

    res.on("finish", () => {
        const duration = Date.now() - start
        metricsState.totalLatencyMs += duration
        metricsState.requestCountForLatency++
        metricsState.recentLatencies.push(duration)
        if (metricsState.recentLatencies.length > 1000) metricsState.recentLatencies.shift()
        if (process.env.NODE_ENV !== "test" && process.env.LOG_REQUESTS === "true") {
            console.log(
                JSON.stringify(
                    sanitize({
                        level: "info",
                        requestId: req.id,
                        method: req.method,
                        path: req.path,
                        status: res.statusCode,
                        durationMs: duration
                    })
                )
            )
        }

        const status = res.statusCode
        metricsState.statusCodes[status] = (metricsState.statusCodes[status] || 0) + 1

        if (req.originalUrl.includes("/transactions/transfer") && status >= 400) {
            metricsState.failedTransfers++
        }
    })

    next()
}

function getMetrics() {
    const avgLatency =
        metricsState.requestCountForLatency > 0
            ? Math.round(metricsState.totalLatencyMs / metricsState.requestCountForLatency)
            : 0

    return {
        totalRequests: metricsState.totalRequests,
        avgLatencyMs: avgLatency,
        p95LatencyMs:
            [...metricsState.recentLatencies].sort((a, b) => a - b)[
                Math.max(0, Math.ceil(metricsState.recentLatencies.length * 0.95) - 1)
            ] || 0,
        failedTransfers: metricsState.failedTransfers,
        statusCodes: metricsState.statusCodes,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsage: process.memoryUsage()
    }
}

module.exports = {
    sanitize,
    requestIdMiddleware,
    metricsMiddleware,
    getMetrics
}
