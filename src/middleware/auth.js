const crypto = require("crypto")
const redisClient = require("../config/redis")
const { redisCommand } = require("../utils/redis-command")
const userModel = require("../models/user")
const sessionModel = require("../models/session")
const {
    UnauthorizedError,
    ForbiddenError,
    AccountLockedError,
    AppError
} = require("../errors/app-error")
const { hashToken, verifyToken, bearerToken } = require("../utils/tokens")
async function protectRoute(req, res, next) {
    try {
        const token = bearerToken(req) || req.cookies?.token
        if (!token) throw new UnauthorizedError("unauthorized")
        const decoded = verifyToken(token, "access")
        let blacklisted
        try {
            blacklisted = await redisCommand(redisClient, "get", "blacklist:" + hashToken(token))
        } catch (_err) {
            throw new AppError("Authentication storage unavailable", 503, "SERVICE_UNAVAILABLE")
        }
        if (blacklisted) throw new UnauthorizedError("unauthorized")
        const user = await userModel.findById(decoded.userId)
        const session = await sessionModel.exists({
            _id: decoded.sid,
            userId: decoded.userId,
            revokedAt: null,
            expiresAt: { $gt: new Date() }
        })
        if (!user || !session || decoded.version !== user.tokenVersion)
            throw new UnauthorizedError("unauthorized")
        if (user.isLocked()) throw new AccountLockedError("Account is temporarily locked")
        req.user = user
        req.auth = decoded
        next()
    } catch (err) {
        next(err)
    }
}
function requireRole(role) {
    return (req, res, next) => {
        if (!req.user) return next(new UnauthorizedError("Authentication required"))
        if (req.user.role !== role)
            return next(new ForbiddenError("Forbidden: requires " + role + " role"))
        next()
    }
}
function csrfSignature(nonce, sid) {
    return crypto
        .createHmac("sha256", process.env.JWT_SECRET)
        .update(sid + ":" + nonce)
        .digest("hex")
}
function createCsrfToken(sid) {
    const nonce = crypto.randomBytes(32).toString("hex")
    return nonce + "." + csrfSignature(nonce, sid)
}
function csrfProtection(req, res, next) {
    try {
        if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next()
        const isRefresh = req.path === "/api/auth/refresh"
        if (!isRefresh && bearerToken(req)) return next()
        const refreshCookie = req.cookies?.refreshToken,
            accessCookie = req.cookies?.token
        if (!accessCookie && !refreshCookie) return next()
        const binding =
            isRefresh && refreshCookie
                ? verifyToken(refreshCookie, "refresh")
                : verifyToken(
                      accessCookie || refreshCookie,
                      accessCookie ? "access" : "refresh",
                      true
                  )
        const cookie = req.cookies?.["csrf-token"],
            header = req.headers["x-csrf-token"]
        if (!cookie || typeof header !== "string" || cookie !== header)
            throw new ForbiddenError("Invalid or missing CSRF token", "CSRF_ERROR")
        const [nonce, signature, extra] = cookie.split(".")
        const expected = csrfSignature(nonce || "", binding.sid)
        if (
            extra ||
            !/^[a-f0-9]{64}$/.test(nonce || "") ||
            !/^[a-f0-9]{64}$/.test(signature || "") ||
            !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        )
            throw new ForbiddenError("Invalid or missing CSRF token", "CSRF_ERROR")
        next()
    } catch (err) {
        next(err)
    }
}
module.exports = { protectRoute, requireRole, csrfProtection, hashToken, createCsrfToken }
