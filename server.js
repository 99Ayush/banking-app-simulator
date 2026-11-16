require("dotenv").config()
const { validateEnv } = require("./src/config/env")
const mongoose = require("mongoose")
async function startServer() {
    validateEnv()
    const app = require("./src/app")
    const redis = require("./src/config/redis")
    await require("./src/config/db")()
    await redis.connect()
    const server = app.listen(Number(process.env.PORT), () =>
        console.log("Banking API listening on port " + process.env.PORT)
    )
    let shuttingDown = false
    async function shutdown() {
        if (shuttingDown) return
        shuttingDown = true
        const deadline = setTimeout(() => process.exit(1), 10000)
        deadline.unref()
        server.close(async () => {
            await Promise.allSettled([mongoose.disconnect(), redis.quit()])
            clearTimeout(deadline)
            process.exit(0)
        })
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
    return server
}
if (require.main === module)
    startServer().catch((err) => {
        console.error("Startup failed:", err && err.message ? err.message : err)
        if (err && err.stack) console.error(err.stack)
        process.exit(1)
    })
module.exports = { startServer }
