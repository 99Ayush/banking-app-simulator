const mongoose = require("mongoose")
const transactionModel = require("../models/transaction")
const accountModel = require("../models/account")
const { NotFoundError, ForbiddenError } = require("../errors/app-error")

class LedgerService {
    async getTransactionHistory(userId, options = {}) {
        const {
            page = 1,
            limit = 20,
            sort = "desc",
            startDate,
            endDate,
            status,
            type,
            accountId
        } = options

        // Find user accounts to restrict query to transactions involving this user
        const userAccounts = await accountModel.find({ userId }).select("_id")
        const accountIds = userAccounts.map((a) => a._id)

        if (accountIds.length === 0) {
            return {
                transactions: [],
                pagination: { total: 0, page, limit, totalPages: 0 }
            }
        }

        const query = {}

        if (accountId) {
            const hasOwnership = accountIds.some((id) => id.toString() === accountId.toString())
            if (!hasOwnership) {
                throw new ForbiddenError("You do not have access to this account's transactions")
            }
            query.$or = [{ fromAccount: accountId }, { toAccount: accountId }]
        } else {
            query.$or = [{ fromAccount: { $in: accountIds } }, { toAccount: { $in: accountIds } }]
        }

        if (status) {
            query.status = status
        }

        if (type) {
            query.type = type
        }

        if (startDate || endDate) {
            query.createdAt = {}
            if (startDate) query.createdAt.$gte = new Date(startDate)
            if (endDate) query.createdAt.$lte = new Date(endDate)
        }

        const sortOrder = sort === "asc" ? 1 : -1
        const skip = (page - 1) * limit

        const [transactions, total] = await Promise.all([
            transactionModel
                .find(query)
                .sort({ createdAt: sortOrder, _id: sortOrder })
                .skip(skip)
                .limit(limit)
                .populate("fromAccount", "accountNumber accountName accountType")
                .populate("toAccount", "accountNumber accountName accountType")
                .lean(),
            transactionModel.countDocuments(query)
        ])

        return {
            transactions,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        }
    }

    async getTransactionDetail(userId, transactionId, userRole = "user") {
        if (!mongoose.Types.ObjectId.isValid(transactionId)) {
            throw new NotFoundError("Transaction not found")
        }

        const transaction = await transactionModel
            .findById(transactionId)
            .populate("fromAccount", "accountNumber accountName userId")
            .populate("toAccount", "accountNumber accountName userId")

        if (!transaction) {
            throw new NotFoundError("Transaction not found")
        }

        // Allow admin full access; verify ownership for regular user
        if (userRole !== "admin") {
            const fromUserId = transaction.fromAccount?.userId?.toString()
            const toUserId = transaction.toAccount?.userId?.toString()
            const currentUserId = userId.toString()

            if (fromUserId !== currentUserId && toUserId !== currentUserId) {
                throw new ForbiddenError("You do not have permission to view this transaction")
            }
        }

        return transaction
    }
}

module.exports = new LedgerService()
