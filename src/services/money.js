const crypto = require("crypto")
const mongoose = require("mongoose")
const Account = require("../models/account")
const Transaction = require("../models/transaction")
const journal = require("./journal")
const { validateAmount, MAX_MONEY, dayKey } = require("../utils/amount")
const { runTransaction } = require("../utils/database-transaction")
const {
    AppError,
    BadRequestError,
    NotFoundError,
    ConflictError,
    InsufficientFundsError
} = require("../errors/app-error")
function normalizedKey(key) {
    if (key === null || key === undefined) return undefined
    if (typeof key !== "string" || key.trim().length < 4 || key.trim().length > 128)
        throw new BadRequestError("Idempotency key must contain 4 to 128 characters")
    return key.trim()
}
function result(tx, replay = false) {
    return {
        success: true,
        isIdempotentReplay: replay,
        message: "Transfer completed successfully",
        data: {
            transactionId: tx._id,
            referenceId: tx.referenceId,
            status: tx.status,
            amount: tx.amount,
            fromAccount: tx.fromAccount,
            toAccount: tx.toAccount
        }
    }
}
function previousFailure(tx) {
    return new AppError(
        tx.failureReason || "Transaction previously failed",
        tx.failureStatus || 400,
        tx.failureCode || "BAD_REQUEST"
    )
}
class MoneyService {
    async execute({
        userId,
        performedBy = userId,
        fromAccount,
        toAccount,
        amount,
        type,
        idempotencyKey
    }) {
        validateAmount(amount)
        for (const id of [fromAccount, toAccount].filter(Boolean))
            if (!mongoose.isObjectIdOrHexString(id)) throw new BadRequestError("Invalid account ID")
        if (type === "TRANSFER" && fromAccount.toString() === toAccount.toString())
            throw new BadRequestError("Cannot transfer to self")
        const requestAccount = type === "DEPOSIT" ? toAccount : fromAccount
        const key = normalizedKey(idempotencyKey)
        const fingerprint = crypto
            .createHash("sha256")
            .update(
                JSON.stringify({
                    type,
                    requestAccount: requestAccount.toString(),
                    toAccount: toAccount.toString(),
                    amount
                })
            )
            .digest("hex")
        let tx
        if (key) tx = await Transaction.findOne({ requestAccount, idempotencyKey: key })
        if (!tx) {
            try {
                tx = await Transaction.create({
                    initiatedBy: userId,
                    performedBy,
                    requestAccount,
                    fromAccount,
                    toAccount,
                    amount,
                    type,
                    idempotencyKey: key,
                    requestFingerprint: fingerprint
                })
            } catch (err) {
                if (err.code !== 11000 || !key) throw err
                tx = await Transaction.findOne({ requestAccount, idempotencyKey: key })
                if (!tx) throw err
            }
        }
        if (tx.requestFingerprint !== fingerprint)
            throw new ConflictError(
                "Idempotency key was used with different payment details",
                "IDEMPOTENCY_CONFLICT"
            )
        if (tx.initiatedBy.toString() !== userId.toString())
            throw new NotFoundError("Transaction not found")
        return this.complete(tx)
    }
    async complete(record) {
        let replay = record.status === "COMPLETED"
        try {
            const completed = await runTransaction(async (session) => {
                const tx = await Transaction.findById(record._id).session(session)
                if (tx.status === "COMPLETED") {
                    replay = true
                    return tx
                }
                if (tx.status === "FAILED") throw previousFailure(tx)
                // Writes the operation record before moving money. Competing workers
                // conflict and retry against its committed status, never debit twice.
                await Transaction.updateOne(
                    { _id: tx._id, status: "PENDING" },
                    { $inc: { attemptCount: 1 } },
                    { session }
                )
                const sender = tx.fromAccount
                    ? await Account.findById(tx.fromAccount).session(session)
                    : null
                const recipient = await Account.findById(tx.toAccount).session(session)
                if (!recipient) throw new NotFoundError("Recipient account not found")
                if (tx.type !== "DEPOSIT" && !sender)
                    throw new NotFoundError("Sender account not found")
                if (recipient.status !== "ACTIVE" || (sender && sender.status !== "ACTIVE"))
                    throw new BadRequestError("Both accounts must be ACTIVE")
                const owned = tx.type === "DEPOSIT" ? recipient : sender
                if (owned.userId.toString() !== tx.initiatedBy.toString())
                    throw new NotFoundError("Account not found or access denied")
                const lockedAccounts = [sender, recipient]
                    .filter(Boolean)
                    .filter(
                        (item, index, items) =>
                            items.findIndex((a) => a._id.toString() === item._id.toString()) ===
                            index
                    )
                    .sort((a, b) => a._id.toString().localeCompare(b._id.toString()))
                for (const item of lockedAccounts)
                    await Account.updateOne(
                        { _id: item._id },
                        { $inc: { ledgerVersion: 1 } },
                        { session }
                    )
                if (sender) await journal.initializeAccount(sender, session)
                if (!sender || sender._id.toString() !== recipient._id.toString())
                    await journal.initializeAccount(recipient, session)
                if (tx.type === "TRANSFER") {
                    const day = dayKey()
                    if (sender.transferDay !== day) {
                        const totals = await Transaction.aggregate([
                            {
                                $match: {
                                    fromAccount: sender._id,
                                    type: "TRANSFER",
                                    status: "COMPLETED"
                                }
                            },
                            {
                                $match: {
                                    $expr: {
                                        $eq: [
                                            {
                                                $dateToString: {
                                                    date: {
                                                        $ifNull: ["$completedAt", "$createdAt"]
                                                    },
                                                    format: "%Y-%m-%d",
                                                    timezone:
                                                        process.env.BANK_TIMEZONE || "Asia/Kolkata"
                                                }
                                            },
                                            day
                                        ]
                                    }
                                }
                            },
                            { $group: { _id: null, amount: { $sum: "$amount" } } }
                        ]).session(session)
                        sender.dailyTransferred = totals[0]?.amount || 0
                        await Account.updateOne(
                            { _id: sender._id },
                            {
                                $set: {
                                    transferDay: day,
                                    dailyTransferred: sender.dailyTransferred
                                }
                            },
                            { session }
                        )
                    }
                    if (sender.dailyTransferred + tx.amount > sender.dailyTransferLimit)
                        throw new BadRequestError("Daily transfer limit exceeded")
                }
                if (sender) {
                    const debit = await Account.updateOne(
                        { _id: sender._id, status: "ACTIVE", balance: { $gte: tx.amount } },
                        {
                            $inc: {
                                balance: -tx.amount,
                                ...(tx.type === "TRANSFER" ? { dailyTransferred: tx.amount } : {})
                            }
                        },
                        { session }
                    )
                    if (!debit.modifiedCount) throw new InsufficientFundsError("Insufficient funds")
                }
                if (tx.type !== "WITHDRAWAL") {
                    const credit = await Account.updateOne(
                        {
                            _id: recipient._id,
                            status: "ACTIVE",
                            balance: { $lte: MAX_MONEY - tx.amount }
                        },
                        { $inc: { balance: tx.amount } },
                        { session }
                    )
                    if (!credit.modifiedCount)
                        throw new BadRequestError("Recipient balance limit exceeded")
                }
                await journal.post(tx, sender, recipient, session)
                return Transaction.findOneAndUpdate(
                    { _id: tx._id, status: "PENDING" },
                    { $set: { status: "COMPLETED", completedAt: new Date() } },
                    { session, returnDocument: "after" }
                )
            })
            return result(completed, replay)
        } catch (err) {
            // Only definitive business failures are persisted. Uncertain infrastructure
            // outcomes remain recoverable using the original operation record.
            if (err.statusCode && err.statusCode < 500)
                await Transaction.updateOne(
                    {
                        _id: record._id,
                        status: "PENDING"
                    },
                    {
                        $set: {
                            status: "FAILED",
                            failureReason: err.message,
                            failureStatus: err.statusCode,
                            failureCode: err.code
                        }
                    }
                )
            if (!err.statusCode || err.statusCode >= 500) {
                const unavailable =
                    err.statusCode === 503
                        ? err
                        : new AppError(
                              "Payment processing unavailable; retry the same operation identity",
                              503,
                              "PAYMENT_UNAVAILABLE"
                          )
                unavailable.data = { transactionId: record._id, referenceId: record.referenceId }
                throw unavailable
            }
            throw err
        }
    }
    async retry(userId, transactionId) {
        const tx = await Transaction.findOne({ _id: transactionId, initiatedBy: userId })
        if (!tx) throw new NotFoundError("Transaction not found")
        return this.complete(tx)
    }
}
module.exports = new MoneyService()
