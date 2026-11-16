const accountModel = require("../models/account")
const transactionModel = require("../models/transaction")
const { BadRequestError, NotFoundError, ForbiddenError } = require("../errors/app-error")

class AccountService {
    async createAccount(userId, { accountType = "SAVINGS", accountName = "Primary Savings" } = {}) {
        // Zero opening balance strictly enforced
        const account = await accountModel.create({
            userId,
            accountType,
            accountName:
                accountName || (accountType === "CURRENT" ? "Current Account" : "Savings Account"),
            balance: 0,
            ledgerInitialized: true,
            dailyTransferLimit: Number(process.env.DAILY_TRANSFER_LIMIT_PAISE || 10000000)
        })

        return account
    }

    async getUserAccounts(userId) {
        return accountModel.find({ userId, status: { $ne: "CLOSED" } }).sort({ createdAt: 1 })
    }

    async getAccountBalance(userId, accountId = null) {
        let query = { userId, status: { $ne: "CLOSED" } }
        if (accountId) {
            query._id = accountId
        }

        const accounts = await accountModel.find(query)
        if (!accounts || accounts.length === 0) {
            throw new NotFoundError("No active accounts found for this user")
        }

        if (accountId) {
            return accounts[0]
        }

        const totalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0)
        return {
            accounts,
            totalBalance
        }
    }

    async getAccountById(accountId, userId = null) {
        const account = await accountModel.findById(accountId)
        if (!account) {
            throw new NotFoundError("Account not found")
        }

        if (userId && account.userId.toString() !== userId.toString()) {
            throw new ForbiddenError("You do not have access to this account")
        }

        return account
    }

    async deposit(userId, accountId, amount, idempotencyKey, administrator = false) {
        // Explicit opt-in: only a literal "true" enables self-service funding.
        if (
            !administrator &&
            (process.env.NODE_ENV === "production" ||
                process.env.SANDBOX_DEPOSITS_ENABLED !== "true")
        ) {
            throw new ForbiddenError(
                "Sandbox deposits are disabled; funding requires an administrator"
            )
        }
        const result = await require("./money").execute({
            userId,
            performedBy: administrator && administrator !== true ? administrator : userId,
            toAccount: accountId,
            amount,
            type: "DEPOSIT",
            idempotencyKey
        })
        return {
            account: await accountModel.findById(accountId),
            transaction: await transactionModel.findById(result.data.transactionId),
            isIdempotentReplay: result.isIdempotentReplay
        }
    }
    async withdraw(userId, accountId, amount, idempotencyKey) {
        const result = await require("./money").execute({
            userId,
            fromAccount: accountId,
            toAccount: accountId,
            amount,
            type: "WITHDRAWAL",
            idempotencyKey
        })
        return {
            account: await accountModel.findById(accountId),
            transaction: await transactionModel.findById(result.data.transactionId),
            isIdempotentReplay: result.isIdempotentReplay
        }
    }
    async setStatus(accountId, status) {
        return require("../utils/database-transaction").runTransaction(async (session) => {
            const account = await accountModel.findById(accountId).session(session)
            if (!account) throw new NotFoundError("Account not found")
            if (account.status === "CLOSED" && status !== "CLOSED")
                throw new BadRequestError("Closed accounts cannot be reopened")
            if (status === "CLOSED" && account.balance !== 0)
                throw new BadRequestError("An account must have zero balance before closing")
            return accountModel.findByIdAndUpdate(
                accountId,
                { $set: { status } },
                { session, returnDocument: "after" }
            )
        })
    }
}
module.exports = new AccountService()
