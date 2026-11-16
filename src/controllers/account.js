const accountService = require("../services/account")

async function createAccountController(req, res, next) {
    try {
        const userId = req.user._id
        const { accountType, accountName } = req.body

        const account = await accountService.createAccount(userId, { accountType, accountName })

        return res.status(201).json({
            success: true,
            status: 201,
            message: "Account created successfully with zero opening balance",
            data: {
                account: {
                    id: account._id,
                    accountNumber: account.accountNumber,
                    accountType: account.accountType,
                    accountName: account.accountName,
                    balance: account.balance,
                    dailyTransferLimit: account.dailyTransferLimit,
                    status: account.status
                }
            }
        })
    } catch (err) {
        next(err)
    }
}

async function getAccountBalanceController(req, res, next) {
    try {
        const userId = req.user._id
        const accountId = req.query.accountId || null

        const balanceData = await accountService.getAccountBalance(userId, accountId)

        return res.status(200).json({
            success: true,
            status: 200,
            data: balanceData
        })
    } catch (err) {
        next(err)
    }
}

async function getUserAccountsController(req, res, next) {
    try {
        const userId = req.user._id
        const accounts = await accountService.getUserAccounts(userId)

        return res.status(200).json({
            success: true,
            status: 200,
            data: {
                accounts
            }
        })
    } catch (err) {
        next(err)
    }
}

async function depositController(req, res, next) {
    try {
        const userId = req.user._id
        const accountId = req.params.accountId || req.body.accountId
        const { amount } = req.body

        const result = await accountService.deposit(userId, accountId, amount, req.idempotencyKey)

        return res.status(200).json({
            success: true,
            status: 200,
            isIdempotentReplay: result.isIdempotentReplay,
            message: "Deposit successful",
            data: {
                accountId: result.account._id,
                balance: result.account.balance,
                transactionId: result.transaction._id,
                referenceId: result.transaction.referenceId
            }
        })
    } catch (err) {
        next(err)
    }
}

async function withdrawController(req, res, next) {
    try {
        const userId = req.user._id
        const accountId = req.params.accountId || req.body.accountId
        const { amount } = req.body

        const result = await accountService.withdraw(userId, accountId, amount, req.idempotencyKey)

        return res.status(200).json({
            success: true,
            status: 200,
            isIdempotentReplay: result.isIdempotentReplay,
            message: "Withdrawal successful",
            data: {
                accountId: result.account._id,
                balance: result.account.balance,
                transactionId: result.transaction._id,
                referenceId: result.transaction.referenceId
            }
        })
    } catch (err) {
        next(err)
    }
}

module.exports = {
    createAccountController,
    getAccountBalanceController,
    getUserAccountsController,
    depositController,
    withdrawController
}
