/* Preflight and dependency diagnosis.
 *
 * Answers the question "why won't it start?" in one command, instead of the
 * generic startup message. Read-only: it never writes to the database.
 *
 *   npm run doctor
 *
 * Exit code 0 = ready, 1 = blocking problem found.
 */
require("dotenv").config()

const dns = require("dns").promises
const mongoose = require("mongoose")
const { createClient } = require("redis")

const problems = []
const warnings = []
const passed = []

const pass = (message) => {
    passed.push(message)
    console.log(`  ok    ${message}`)
}
const fail = (message) => {
    problems.push(message)
    console.log(`  FAIL  ${message}`)
}
const warn = (message) => {
    warnings.push(message)
    console.log(`  warn  ${message}`)
}

function mask(uri) {
    if (!uri) return "(missing)"
    return uri.replace(/\/\/([^:/@]+):([^@]*)@/, (match, user) => `//${user}:****@`)
}

function section(title) {
    console.log("\n" + title)
    console.log("-".repeat(title.length))
}

async function checkEnvironment() {
    section("Environment")
    const required = ["MONGO_URI", "REDIS_URL", "JWT_SECRET", "JWT_REFRESH_SECRET"]
    for (const key of required) {
        if (!process.env[key]) {
            fail(`${key} is missing from .env`)
            continue
        }
        const shown = /_URI$|_URL$/.test(key) ? mask(process.env[key]) : `[${process.env[key].length} chars]`
        pass(`${key} is set: ${shown}`)
    }

    for (const key of ["JWT_SECRET", "JWT_REFRESH_SECRET"]) {
        const value = process.env[key]
        if (!value) continue
        if (value.length < 32) fail(`${key} is ${value.length} chars; use at least 32`)
        else pass(`${key} length is ${value.length}`)
    }
    if (
        process.env.JWT_SECRET &&
        process.env.JWT_REFRESH_SECRET &&
        process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET
    )
        fail("JWT_SECRET and JWT_REFRESH_SECRET are identical; they must differ")

    const nodeEnv = process.env.NODE_ENV || "development"
    pass(`NODE_ENV is ${nodeEnv}`)

    const mongoUri = process.env.MONGO_URI || ""
    if (!/^mongodb(\+srv)?:\/\//.test(mongoUri)) {
        fail("MONGO_URI must start with mongodb:// or mongodb+srv://")
        return
    }

    // A database name in the path is required; without it the driver picks a default.
    const withoutScheme = mongoUri.replace(/^mongodb(\+srv)?:\/\//, "")
    const pathPart = withoutScheme.split("/")[1] || ""
    const dbName = pathPart.split("?")[0]
    if (!dbName) warn("MONGO_URI has no database name; add /banking-app before the '?'")
    else pass(`target database is "${dbName}"`)

    if (mongoUri.startsWith("mongodb+srv://")) {
        const host = withoutScheme.split("@").pop().split("/")[0].split(",")[0]
        const srvName = `_mongodb._tcp.${host}`
        try {
            const records = await dns.resolveSrv(srvName)
            pass(`SRV lookup for ${host} returned ${records.length} host(s)`)
        } catch (err) {
            const nodeServers = require("dns").getServers().join(", ")
            if (err.code === "ECONNREFUSED" || err.code === "ECONNRESET") {
                fail(
                    `SRV lookup failed (${err.code}) but this is a local resolver problem, not a dead cluster.\n` +
                        `        Node's resolver is pointed at: ${nodeServers}\n` +
                        `        Use the standard Atlas string instead (hosts from the SRV records,\n` +
                        `        replicaSet/authSource from the TXT record, ssl=true).`
                )
            } else if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
                fail(
                    `SRV lookup for ${host} found nothing. The cluster is paused or deleted.\n` +
                        `        Check cloud.mongodb.com: free clusters are paused after inactivity.`
                )
            } else fail(`SRV lookup failed: ${err.code || err.message}`)
        }
    } else {
        pass("MONGO_URI uses the standard (non-SRV) format")
    }
}

async function checkMongo() {
    section("MongoDB")
    if (!process.env.MONGO_URI) {
        fail("skipped: MONGO_URI is missing")
        return
    }
    try {
        await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 })
        await mongoose.connection.db.admin().command({ ping: 1 })
        pass(`connected to "${mongoose.connection.name}"`)

        const hello = await mongoose.connection.db.admin().command({ hello: 1 })
        if (hello.setName) {
            pass(`replica set "${hello.setName}" — multi-document transactions are available`)
            if (hello.msg === "isdbgrid") pass("target is a sharded cluster")
        } else {
            fail(
                "connected to a standalone server: transactions require a replica set. " +
                    "Accept writes will fail with 'Transaction numbers are only allowed on a replica set member'."
            )
        }

        const collections = await mongoose.connection.db.listCollections().toArray()
        pass(`${collections.length} collection(s): ${collections.map((c) => c.name).join(", ") || "none"}`)

        const counts = {}
        for (const name of ["users", "accounts", "transactions", "journals"]) {
            try {
                counts[name] = await mongoose.connection.db.collection(name).countDocuments()
            } catch (_err) {
                counts[name] = 0
            }
        }
        pass(
            `data: ${counts.users} users, ${counts.accounts} accounts, ` +
                `${counts.transactions} transactions, ${counts.journals} journals`
        )
        if (counts.users === 0) warn("no users yet; run `npm run seed` to create sample accounts")
        if (counts.accounts > 0 && counts.journals === 0)
            warn("accounts exist but there are no journal entries; run `npm run migrate`")
    } catch (err) {
        const hint = /bad auth|Authentication failed/i.test(err.message)
            ? "credentials rejected: check the database user and password"
            : /ENOTFOUND|querySrv|ECONNREFUSED/i.test(err.message)
              ? "host not reachable: the cluster is paused or deleted, or DNS cannot resolve it"
              : /ETIMEDOUT|Server selection timed out/i.test(err.message)
                ? "no server answered: check Network Access (IP allowlist) in Atlas"
                : "see the message above"
        fail(`cannot reach MongoDB: ${err.message}\n        ${hint}`)
    }
}

async function checkRedis() {
    section("Redis")
    if (!process.env.REDIS_URL) {
        fail("skipped: REDIS_URL is missing")
        return
    }
    const client = createClient({
        url: process.env.REDIS_URL,
        socket: {
            ...(process.env.REDIS_URL.startsWith("rediss://") ? { tls: true } : {}),
            connectTimeout: 8000,
            reconnectStrategy: false
        },
        disableOfflineQueue: true
    })
    client.on("error", () => {})
    try {
        await client.connect()
        const pong = await client.ping()
        pass(`connected, PING replied "${pong}"`)
        if (process.env.NODE_ENV === "production" && !process.env.REDIS_URL.startsWith("rediss://"))
            warn("REDIS_URL is not TLS (rediss://) in production")
    } catch (err) {
        const hint = /ENOTFOUND/i.test(err.message)
            ? "host not reachable: the database was deleted or the hostname is wrong"
            : /WRONGPASS|NOAUTH|invalid password/i.test(err.message)
              ? "password rejected: re-copy the connection string"
              : "the API fails closed without Redis: every authenticated request would return 503"
        fail(`cannot reach Redis: ${err.message}\n        ${hint}`)
    } finally {
        await client.quit().catch(() => {})
    }
}

function checkDeploymentSettings() {
    section("Deployment settings")
    const nodeEnv = process.env.NODE_ENV || "development"
    const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0)

    if (proxyHops === 0)
        warn(
            "TRUST_PROXY_HOPS=0: correct only if nothing sits in front of Node. " +
                "Behind Render/Vercel/nginx set it to the number of proxies, otherwise all clients share one rate-limit bucket."
        )
    else pass(`TRUST_PROXY_HOPS=${proxyHops}`)

    if (process.env.SANDBOX_DEPOSITS_ENABLED === "true") {
        if (nodeEnv === "production")
            fail("SANDBOX_DEPOSITS_ENABLED=true in production: startup will refuse to run")
        else warn("self-service deposits are ON (development only). Never enable this on a public host.")
    } else pass("self-service deposits are OFF (admin funding only)")

    const origins = (process.env.CLIENT_URL || "").split(",").map((o) => o.trim()).filter(Boolean)
    if (origins.length === 0) warn("CLIENT_URL is unset; only http://localhost:3000 is allowed")
    else if (nodeEnv === "production" && origins.some((o) => !o.startsWith("https://")))
        fail("CLIENT_URL must use https:// in production (cookie clients)")
    else pass(`allowed CORS origin(s): ${origins.join(", ")}`)
}

async function main() {
    console.log("Banking API doctor")
    console.log("==================")
    await checkEnvironment()
    await checkMongo()
    await checkRedis()
    checkDeploymentSettings()

    section("Result")
    console.log(`${passed.length} check(s) passed, ${warnings.length} warning(s), ${problems.length} blocking problem(s)`)
    if (!problems.length) console.log("\nNo blocking problems found. `npm start` should work.")
    else {
        console.log("\nThe API will not serve money requests until the FAIL items above are fixed.")
        process.exitCode = 1
    }
}

main()
    .catch((err) => {
        console.error("doctor crashed:", err && err.message ? err.message : err)
        process.exitCode = 1
    })
    .finally(() => mongoose.disconnect().catch(() => {}))
