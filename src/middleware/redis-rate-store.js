const crypto = require("crypto")
const { AppError } = require("../errors/app-error")
const { redisCommand } = require("../utils/redis-command")
const script =
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('PTTL',KEYS[1])}"
class RedisRateStore {
    constructor(client, prefix) {
        this.client = client
        this.prefix = prefix
        this.localKeys = false
    }
    init(options) {
        this.windowMs = options.windowMs
    }
    key(value) {
        return this.prefix + crypto.createHash("sha256").update(value).digest("hex")
    }
    async increment(key) {
        try {
            const [totalHits, ttl] = await redisCommand(this.client, "eval", script, {
                keys: [this.key(key)],
                arguments: [String(this.windowMs)]
            })
            return { totalHits: Number(totalHits), resetTime: new Date(Date.now() + Number(ttl)) }
        } catch (_err) {
            throw new AppError("Rate limit storage unavailable", 503, "SERVICE_UNAVAILABLE")
        }
    }
    async decrement(key) {
        await this.client.eval(
            "if redis.call('EXISTS',KEYS[1])==1 then return redis.call('DECR',KEYS[1]) end; return 0",
            { keys: [this.key(key)], arguments: [] }
        )
    }
    async resetKey(key) {
        await this.client.del(this.key(key))
    }
}
module.exports = { RedisRateStore }
