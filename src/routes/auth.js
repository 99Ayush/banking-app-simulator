const express = require("express")
const authController = require("../controllers/auth")
const { validate } = require("../middleware/validate")
const { authLimiter } = require("../middleware/rate-limit")
const {
    registerSchema,
    loginSchema,
    logoutSchema,
    refreshTokenSchema
} = require("../validators/auth")

const router = express.Router()

/*
 * POST /api/auth/register
 */
router.post(
    "/register",
    authLimiter,
    validate(registerSchema),
    authController.userRegisterController
)

/*
 * POST /api/auth/login
 */
router.post("/login", authLimiter, validate(loginSchema), authController.userLoginController)

/*
 * POST /api/auth/logout
 */
router.post("/logout", validate(logoutSchema), authController.userLogoutController)

/*
 * POST /api/auth/refresh
 */
router.post(
    "/refresh",
    authLimiter,
    validate(refreshTokenSchema),
    authController.refreshTokenController
)

module.exports = router
