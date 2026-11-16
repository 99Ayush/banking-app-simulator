const express = require("express")
const { z } = require("zod")
const controller = require("../controllers/admin")
const { protectRoute, requireRole } = require("../middleware/auth")
const { validate } = require("../middleware/validate")
const { paginationQuerySchema } = require("../validators/transaction")
const { depositWithdrawSchema } = require("../validators/account")
const { idempotencyKey } = require("../middleware/idempotency")
const { BadRequestError, NotFoundError } = require("../errors/app-error")
const Account = require("../models/account")
const Transaction = require("../models/transaction")
const router = express.Router()
router.use(protectRoute, requireRole("admin"))
router.get("/users", validate(paginationQuerySchema, "query"), controller.getAllUsersController)
router.get(
    "/accounts",
    validate(paginationQuerySchema, "query"),
    controller.getAllAccountsController
)
router.get(
    "/transactions/failed",
    validate(paginationQuerySchema, "query"),
    controller.getFailedTransfersController
)
router.get(
    "/transactions/pending",
    validate(paginationQuerySchema, "query"),
    async (req, res, next) => {
        try {
            const page = req.query.page || 1,
                limit = req.query.limit || 50
            const [transactions, total] = await Promise.all([
                Transaction.find({ status: "PENDING" })
                    .sort({ createdAt: 1, _id: 1 })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .lean(),
                Transaction.countDocuments({ status: "PENDING" })
            ])
            res.json({
                success: true,
                data: {
                    transactions,
                    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
                }
            })
        } catch (err) {
            next(err)
        }
    }
)
router.get("/ledger/reconciliation", async (req, res, next) => {
    try {
        res.json({
            success: true,
            data: await require("../services/reconciliation").reconcile()
        })
    } catch (err) {
        next(err)
    }
})
router.patch(
    "/accounts/:id/status",
    validate(z.object({ status: z.enum(["ACTIVE", "FROZEN", "CLOSED"]) }).strict()),
    async (req, res, next) => {
        try {
            res.json({
                success: true,
                data: await require("../services/account").setStatus(
                    req.params.id,
                    req.body.status
                )
            })
        } catch (err) {
            next(err)
        }
    }
)
router.post(
    "/accounts/:id/funding",
    validate(depositWithdrawSchema),
    idempotencyKey,
    async (req, res, next) => {
        try {
            if (!req.idempotencyKey)
                throw new BadRequestError(
                    "An Idempotency-Key is required for administrator funding"
                )
            const account = await Account.findById(req.params.id)
            if (!account) throw new NotFoundError("Account not found")
            const result = await require("../services/account").deposit(
                account.userId,
                account._id,
                req.body.amount,
                req.idempotencyKey,
                req.user._id
            )
            res.json({
                success: true,
                isIdempotentReplay: result.isIdempotentReplay,
                data: {
                    transactionId: result.transaction._id,
                    referenceId: result.transaction.referenceId,
                    balance: result.account.balance
                }
            })
        } catch (err) {
            next(err)
        }
    }
)
module.exports = router
