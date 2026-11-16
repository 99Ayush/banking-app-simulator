const Account = require("../models/account")
const Journal = require("../models/journal")
const Transaction = require("../models/transaction")
const { runTransaction } = require("../utils/database-transaction")
async function reconcile() {
    return runTransaction(async (session) => {
        const accounts = await Account.find().session(session).lean()
        const journals = await Journal.find().session(session).lean()
        const transactions = await Transaction.find({
            status: "COMPLETED",
            requestFingerprint: { $exists: true },
            legacyCheckpoint: { $ne: true }
        })
            .session(session)
            .lean()
        const balances = new Map(),
            issues = [],
            journalTransactions = new Set()
        for (const entry of journals) {
            let net = 0n
            for (const row of entry.postings) {
                const amount = BigInt(row.amount)
                net += row.side === "DEBIT" ? amount : -amount
                balances.set(
                    row.ledgerAccount,
                    (balances.get(row.ledgerAccount) || 0n) +
                        (row.side === row.normalSide ? amount : -amount)
                )
            }
            if (net !== 0n) issues.push({ journalId: entry._id, code: "UNBALANCED_JOURNAL" })
            if (entry.transactionId) journalTransactions.add(entry.transactionId.toString())
        }
        for (const account of accounts) {
            const expected = balances.get("customer:" + account._id) || 0n
            if (!account.ledgerInitialized && account.balance > 0)
                issues.push({ accountId: account._id, code: "OPENING_CHECKPOINT_REQUIRED" })
            else if (expected !== BigInt(account.balance))
                issues.push({
                    accountId: account._id,
                    code: "BALANCE_MISMATCH",
                    storedBalance: account.balance,
                    journalBalance: expected.toString()
                })
        }
        for (const tx of transactions)
            if (!journalTransactions.has(tx._id.toString()))
                issues.push({ transactionId: tx._id, code: "MISSING_JOURNAL" })
        return {
            consistent: issues.length === 0,
            accountCount: accounts.length,
            journalCount: journals.length,
            checkedAt: new Date(),
            issues,
            ledgerBalances: Object.fromEntries(
                [...balances].map(([key, value]) => [key, value.toString()])
            )
        }
    })
}
module.exports = { reconcile }
