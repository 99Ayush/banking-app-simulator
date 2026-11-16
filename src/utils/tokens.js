const crypto = require("crypto")
const jwt = require("jsonwebtoken")
const { UnauthorizedError } = require("../errors/app-error")
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex")
function secret(type) {
    const value = type === "refresh" ? process.env.JWT_REFRESH_SECRET : process.env.JWT_SECRET
    if (!value && process.env.NODE_ENV !== "test") throw new Error("JWT signing secret is missing")
    return value || process.env.JWT_SECRET
}
function issueTokens(user, sid) {
    const claims = { userId: user._id.toString(), sid, version: user.tokenVersion || 0 }
    const options = { algorithm: "HS256", issuer: "banking-backend", audience: "banking-api" }
    return {
        accessToken: jwt.sign({ ...claims, role: user.role, type: "access" }, secret("access"), {
            ...options,
            expiresIn: "15m",
            jwtid: crypto.randomUUID()
        }),
        refreshToken: jwt.sign({ ...claims, type: "refresh" }, secret("refresh"), {
            ...options,
            expiresIn: "7d",
            jwtid: crypto.randomUUID()
        })
    }
}
function verifyToken(token, type, ignoreExpiration = false) {
    try {
        const decoded = jwt.verify(token, secret(type), {
            algorithms: ["HS256"],
            issuer: "banking-backend",
            audience: "banking-api",
            ignoreExpiration
        })
        if (
            decoded.type !== type ||
            !decoded.sid ||
            !decoded.jti ||
            !Number.isInteger(decoded.version)
        )
            throw new Error("Invalid token type")
        return decoded
    } catch (_err) {
        throw new UnauthorizedError("Invalid or expired " + type + " token")
    }
}
function bearerToken(req) {
    if (req.headers.authorization === undefined) return null
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization)
    if (!match) throw new UnauthorizedError("Invalid Authorization header")
    return match[1]
}
module.exports = { hashToken, issueTokens, verifyToken, bearerToken }
