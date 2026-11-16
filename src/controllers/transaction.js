const transferService = require("../services/transfer")
const ledgerService = require("../services/ledger")

async function transferFundsController(req, res, next) {
    try {
        const { senderAccountId, toAccountId, amount } = req.body
        const idempotencyKey = req.idempotencyKey
        const userId = req.user._id

        const result = await transferService.executeTransfer({
            userId,
            senderAccountId,
            toAccountId,
            amount,
            idempotencyKey
        })

        return res.status(200).json(result)
    } catch (err) {
        next(err)
    }
}

async function getTransactionHistoryController(req, res, next) {
    try {
        const userId = req.user._id
        const result = await ledgerService.getTransactionHistory(userId, req.query)

        return res.status(200).json({
            success: true,
            status: 200,
            data: result
        })
    } catch (err) {
        next(err)
    }
}

async function getTransactionDetailController(req, res, next) {
    try {
        const userId = req.user._id
        const userRole = req.user.role
        const transactionId = req.params.id

        const transaction = await ledgerService.getTransactionDetail(
            userId,
            transactionId,
            userRole
        )

        return res.status(200).json({
            success: true,
            status: 200,
            data: {
                transaction
            }
        })
    } catch (err) {
        next(err)
    }
}

module.exports = {
    transferFundsController,
    getTransactionHistoryController,
    getTransactionDetailController
}
