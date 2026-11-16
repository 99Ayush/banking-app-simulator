const express = require("express")
const accountController = require("../controllers/account")
const { protectRoute } = require("../middleware/auth")
const { validate } = require("../middleware/validate")
const { createAccountSchema, depositWithdrawSchema } = require("../validators/account")

const { idempotencyKey } = require("../middleware/idempotency")
const router = express.Router()

/*
 * POST /api/v1/accounts
 * Authenticated account-creation with zero opening balance
 */
router.post(
    "/",
    protectRoute,
    validate(createAccountSchema),
    accountController.createAccountController
)

/*
 * GET /api/v1/accounts/balance
 * Returns safe account balance for current user
 */
router.get(
    "/balance",
    protectRoute,
    validate(require("../validators/transaction").balanceQuerySchema, "query"),
    accountController.getAccountBalanceController
)

/*
 * GET /api/v1/accounts/me
 * Returns all active accounts belonging to authenticated user
 */
router.get("/me", protectRoute, accountController.getUserAccountsController)

/*
 * POST /api/v1/accounts/:accountId/deposit
 * Deposit funds (in integer paise)
 */
router.post(
    "/:accountId/deposit",
    protectRoute,
    validate(depositWithdrawSchema),
    idempotencyKey,
    accountController.depositController
)

/*
 * POST /api/v1/accounts/:accountId/withdraw
 * Withdraw funds (in integer paise)
 */
router.post(
    "/:accountId/withdraw",
    protectRoute,
    validate(depositWithdrawSchema),
    idempotencyKey,
    accountController.withdrawController
)

router.get(
    "/:accountId/ledger",
    protectRoute,
    validate(require("../validators/transaction").journalQuerySchema, "query"),
    async (req, res, next) => {
        try {
            await require("../services/account").getAccountById(
                req.params.accountId,
                req.user._id
            )
            const page = Math.max(1, Number(req.query.page) || 1),
                limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
            const query = { "postings.accountId": req.params.accountId }
            if (req.query.startDate || req.query.endDate) {
                query.createdAt = {}
                if (req.query.startDate) query.createdAt.$gte = new Date(req.query.startDate)
                if (req.query.endDate) query.createdAt.$lte = new Date(req.query.endDate)
            }
            const direction = req.query.sort === "asc" ? 1 : -1
            const Journal = require("../models/journal")
            const [journals, total] = await Promise.all([
                Journal.find(query)
                    .sort({ createdAt: direction, _id: direction })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .lean(),
                Journal.countDocuments(query)
            ])
            res.json({
                success: true,
                data: {
                    journals,
                    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
                }
            })
        } catch (err) {
            next(err)
        }
    }
)
module.exports = router
