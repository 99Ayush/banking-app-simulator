const express = require("express")
const transactionController = require("../controllers/transaction")
const { protectRoute } = require("../middleware/auth")
const { validate } = require("../middleware/validate")
const { transferLimiter } = require("../middleware/rate-limit")
const { idempotencyKey } = require("../middleware/idempotency")
const {
    transferSchema,
    transactionHistoryQuerySchema
} = require("../validators/transaction")

const router = express.Router()

/*
 * POST /api/v1/transactions/transfer
 * Authenticated safe transfer with idempotency & conditional debit
 */
router.post(
    "/transfer",
    protectRoute,
    transferLimiter,
    validate(transferSchema),
    idempotencyKey,
    transactionController.transferFundsController
)

/*
 * GET /api/v1/transactions
 * Transaction history with pagination and filters
 */
router.get(
    "/",
    protectRoute,
    validate(transactionHistoryQuerySchema, "query"),
    transactionController.getTransactionHistoryController
)

/*
 * GET /api/v1/transactions/:id
 * Transaction detail protected by ownership check
 */
router.get("/:id", protectRoute, transactionController.getTransactionDetailController)

router.post("/:id/retry", protectRoute, transferLimiter, async (req, res, next) => {
    try {
        if (!require("mongoose").isObjectIdOrHexString(req.params.id))
            return res
                .status(400)
                .json({ success: false, code: "INVALID_ID", message: "Invalid transaction ID" })
        res.json(await require("../services/money").retry(req.user._id, req.params.id))
    } catch (err) {
        next(err)
    }
})
module.exports = router
