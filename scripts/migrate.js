require("dotenv").config()
const crypto = require("crypto")
const mongoose = require("mongoose")
const Account = require("../src/models/account")
const Transaction = require("../src/models/transaction")
require("../src/models/user")
require("../src/models/beneficiary")
require("../src/models/session")
require("../src/models/journal")
const { runTransaction } = require("../src/utils/database-transaction")
const { initializeAccount } = require("../src/services/journal")
async function migrate(apply = false) {
    await mongoose.connect(process.env.MONGO_URI, {
        autoIndex: false,
        serverSelectionTimeoutMS: 5000
    })
    const legacy = await Transaction.find({ requestFingerprint: { $exists: false } }).lean()
    const accounts = await Account.find({ ledgerInitialized: { $ne: true } })
    const pending = await Transaction.countDocuments({ status: "PENDING" })
    console.log(
        JSON.stringify({
            apply,
            legacyTransactions: legacy.length,
            openingCheckpoints: accounts.length,
            pendingOperations: pending
        })
    )
    if (!apply) return
    if (pending) throw new Error("Resolve pending operations before migration")
    for (const tx of legacy) {
        const requestAccount = tx.type === "DEPOSIT" ? tx.toAccount : tx.fromAccount
        const owner = await Account.findById(requestAccount)
        const update = {
            requestAccount,
            initiatedBy: owner?.userId,
            legacyCheckpoint: true,
            requestFingerprint: crypto
                .createHash("sha256")
                .update(
                    JSON.stringify({
                        type: tx.type,
                        requestAccount: requestAccount?.toString(),
                        toAccount: tx.toAccount.toString(),
                        amount: tx.amount
                    })
                )
                .digest("hex")
        }
        if (tx.status === "COMPLETED") update.completedAt = tx.createdAt
        await Transaction.collection.updateOne(
            { _id: tx._id },
            { $set: update, ...(!tx.idempotencyKey ? { $unset: { idempotencyKey: "" } } : {}) }
        )
    }
    let indexes = []
    try {
        indexes = await Transaction.collection.indexes()
    } catch (err) {
        if (err.code !== 26) throw err
    }
    for (const index of indexes)
        if (index.key.fromAccount && index.key.idempotencyKey)
            await Transaction.collection.dropIndex(index.name)
    await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()))
    for (const account of accounts)
        await runTransaction(async (session) => {
            const latest = await Account.findById(account._id).session(session)
            await Account.updateOne(
                { _id: account._id },
                { $inc: { ledgerVersion: 1 } },
                { session }
            )
            await initializeAccount(latest, session)
        })
    console.log("Migration complete. Existing balances were checkpointed, not altered.")
}
if (require.main === module)
    migrate(process.argv.includes("--apply"))
        .catch((err) => {
            console.error(err.message)
            process.exitCode = 1
        })
        .finally(() => mongoose.disconnect())
module.exports = { migrate }
