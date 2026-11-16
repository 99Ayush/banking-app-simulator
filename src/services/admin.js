const userModel = require("../models/user")
const accountModel = require("../models/account")
const transactionModel = require("../models/transaction")

class AdminService {
    async getAllUsers(options = {}) {
        const { page = 1, limit = 50 } = options
        const skip = (page - 1) * limit

        const [users, total] = await Promise.all([
            userModel
                .find()
                .select("-password -refreshTokenHash")
                .sort({ createdAt: 1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            userModel.countDocuments()
        ])

        return {
            users,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
        }
    }

    async getAllAccounts(options = {}) {
        const { page = 1, limit = 50 } = options
        const skip = (page - 1) * limit

        const [accounts, total] = await Promise.all([
            accountModel
                .find()
                .populate("userId", "name email")
                .sort({ createdAt: 1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            accountModel.countDocuments()
        ])

        return {
            accounts,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
        }
    }

    async getFailedTransfers(options = {}) {
        const { page = 1, limit = 50 } = options
        const skip = (page - 1) * limit

        const query = { status: "FAILED", type: "TRANSFER" }

        const [failedTransfers, total] = await Promise.all([
            transactionModel
                .find(query)
                .sort({ createdAt: -1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .populate("fromAccount", "accountNumber accountName")
                .populate("toAccount", "accountNumber accountName")
                .lean(),
            transactionModel.countDocuments(query)
        ])

        return {
            failedTransfers,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
        }
    }
}

module.exports = new AdminService()
