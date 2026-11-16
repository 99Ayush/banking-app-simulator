const crypto = require("crypto")
const userModel = require("../models/user")
const sessionModel = require("../models/session")
const redisClient = require("../config/redis")
const { redisCommand } = require("../utils/redis-command")
const { hashToken, issueTokens, verifyToken } = require("../utils/tokens")
const {
    UnauthorizedError,
    ConflictError,
    AccountLockedError,
    AppError
} = require("../errors/app-error")
async function startSession(user) {
    const sid = crypto.randomUUID()
    const tokens = issueTokens(user, sid)
    await sessionModel.create({
        _id: sid,
        userId: user._id,
        refreshTokenHash: hashToken(tokens.refreshToken),
        expiresAt: new Date(Date.now() + 7 * 86400000)
    })
    return { user, ...tokens }
}
async function revokeAll(userId) {
    await userModel.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } })
    await sessionModel.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } })
}
class AuthService {
    async register({ name, email, password }) {
        if (await userModel.exists({ email })) {
            const err = new ConflictError("user already exists with this email.")
            err.statusCode = err.status = 422
            throw err
        }
        return startSession(await userModel.create({ name, email, password, role: "user" }))
    }
    async login({ email, password }) {
        const user = await userModel.findOne({ email }).select("+password")
        if (!user) throw new UnauthorizedError("invalid credentials")
        if (user.isLocked()) throw new AccountLockedError("Account locked. Try again later.")
        if (!(await user.comparepassword(password))) {
            const now = new Date()
            await userModel.updateOne(
                { _id: user._id },
                [
                    {
                        $set: {
                            failedLoginAttempts: {
                                $add: [
                                    {
                                        $cond: [
                                            {
                                                $and: [
                                                    {
                                                        $ne: [
                                                            { $ifNull: ["$lockUntil", null] },
                                                            null
                                                        ]
                                                    },
                                                    { $lte: ["$lockUntil", now] }
                                                ]
                                            },
                                            0,
                                            { $ifNull: ["$failedLoginAttempts", 0] }
                                        ]
                                    },
                                    1
                                ]
                            }
                        }
                    },
                    {
                        $set: {
                            lockUntil: {
                                $cond: [
                                    { $gte: ["$failedLoginAttempts", 5] },
                                    new Date(Date.now() + 900000),
                                    "$lockUntil"
                                ]
                            }
                        }
                    }
                ],
                { updatePipeline: true }
            )
            throw new UnauthorizedError("invalid credentials")
        }
        await userModel.updateOne(
            { _id: user._id },
            { $set: { failedLoginAttempts: 0 }, $unset: { lockUntil: 1 } }
        )
        return startSession(user)
    }
    async refreshTokens(refreshToken) {
        if (!refreshToken) throw new UnauthorizedError("Refresh token missing")
        const decoded = verifyToken(refreshToken, "refresh")
        const user = await userModel.findById(decoded.userId)
        if (!user || user.isLocked() || decoded.version !== user.tokenVersion)
            throw new UnauthorizedError("Session revoked")
        const tokens = issueTokens(user, decoded.sid)
        const session = await sessionModel.findOneAndUpdate(
            {
                _id: decoded.sid,
                userId: user._id,
                revokedAt: null,
                expiresAt: { $gt: new Date() },
                refreshTokenHash: hashToken(refreshToken)
            },
            {
                $set: {
                    refreshTokenHash: hashToken(tokens.refreshToken),
                    expiresAt: new Date(Date.now() + 7 * 86400000)
                }
            },
            { returnDocument: "after" }
        )
        if (!session) {
            await revokeAll(user._id)
            throw new UnauthorizedError(
                "Refresh token reuse or revoked session. Please log in again."
            )
        }
        return { user, ...tokens }
    }
    async logout(token) {
        if (!token) throw new UnauthorizedError("Access token missing")
        const decoded = verifyToken(token, "access", true)
        await sessionModel.updateOne(
            { _id: decoded.sid, userId: decoded.userId },
            { $set: { revokedAt: new Date() } }
        )
        const ttl = decoded.exp - Math.floor(Date.now() / 1000)
        if (ttl > 0) {
            try {
                await redisCommand(
                    redisClient,
                    "setEx",
                    "blacklist:" + hashToken(token),
                    ttl,
                    "true"
                )
            } catch (_err) {
                throw new AppError("Revocation storage unavailable", 503, "SERVICE_UNAVAILABLE")
            }
        }
    }
}
module.exports = new AuthService()
