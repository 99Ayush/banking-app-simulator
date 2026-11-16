const { createClient } = require("redis")
const redisUrl = process.env.REDIS_URL
const redisClient = createClient({
    url: redisUrl,
    socket: {
        ...(redisUrl?.startsWith("rediss://") ? { tls: true } : {}),
        connectTimeout: 5000,
        reconnectStrategy: (retries) => Math.min(100 * retries, 2000)
    },
    disableOfflineQueue: true
})
redisClient.on("error", () => {
    if (process.env.NODE_ENV !== "test") console.error("Redis connection unavailable")
})
module.exports = redisClient
