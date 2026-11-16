const authService = require("../services/auth")
const { verifyToken, bearerToken } = require("../utils/tokens")
const { createCsrfToken } = require("../middleware/auth")
function cookieOptions(path, maxAge) {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path,
        maxAge
    }
}
function respond(res, result, status, message) {
    const csrfToken = createCsrfToken(verifyToken(result.accessToken, "access").sid)
    res.cookie("token", result.accessToken, cookieOptions("/", 900000))
    res.cookie("refreshToken", result.refreshToken, cookieOptions("/api/auth", 7 * 86400000))
    res.cookie("csrf-token", csrfToken, { ...cookieOptions("/", 7 * 86400000), httpOnly: false })
    return res.status(status).json({
        success: true,
        status,
        message,
        data: {
            user: {
                id: result.user._id,
                name: result.user.name,
                email: result.user.email,
                role: result.user.role
            },
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            csrfToken
        }
    })
}
async function userRegisterController(req, res, next) {
    try {
        return respond(
            res,
            await authService.register(req.body),
            201,
            "user registered successfully"
        )
    } catch (err) {
        next(err)
    }
}
async function userLoginController(req, res, next) {
    try {
        return respond(res, await authService.login(req.body), 200, "login successful")
    } catch (err) {
        next(err)
    }
}
async function userLogoutController(req, res, next) {
    try {
        await authService.logout(bearerToken(req) || req.cookies?.token)
        res.clearCookie("token", cookieOptions("/", 0))
        res.clearCookie("refreshToken", cookieOptions("/api/auth", 0))
        res.clearCookie("csrf-token", { ...cookieOptions("/", 0), httpOnly: false })
        return res
            .status(200)
            .json({ success: true, status: 200, message: "logged out successfully" })
    } catch (err) {
        next(err)
    }
}
async function refreshTokenController(req, res, next) {
    try {
        return respond(
            res,
            await authService.refreshTokens(req.cookies?.refreshToken || req.body?.refreshToken),
            200,
            "Tokens refreshed successfully"
        )
    } catch (err) {
        next(err)
    }
}
module.exports = {
    userRegisterController,
    userLoginController,
    userLogoutController,
    refreshTokenController
}
