const Journal = require("../models/journal")
const Account = require("../models/account")
function customer(account, side, amount) {
    return {
        ledgerAccount: "customer:" + account._id,
        accountId: account._id,
        kind: "LIABILITY",
        normalSide: "CREDIT",
        side,
        amount
    }
}
function cash(side, amount, opening = false) {
    return {
        ledgerAccount: opening ? "system:opening-clearing" : "system:cash",
        kind: "ASSET",
        normalSide: "DEBIT",
        side,
        amount
    }
}
async function initializeAccount(account, session) {
    if (account.ledgerInitialized) return
    // Explicitly checkpoint legacy balances; historical transfers remain audit records.
    // Once initialized, balance changes must have matching immutable journal postings.
    if (account.balance > 0)
        await Journal.create(
            [
                {
                    operationId: "OPENING-" + account._id,
                    description: "Legacy opening balance checkpoint",
                    postings: [
                        cash("DEBIT", account.balance, true),
                        customer(account, "CREDIT", account.balance)
                    ]
                }
            ],
            { session }
        )
    await Account.updateOne(
        { _id: account._id },
        { $set: { ledgerInitialized: true } },
        { session }
    )
}
async function post(transaction, sender, recipient, session) {
    const amount = transaction.amount
    let postings
    if (transaction.type === "TRANSFER")
        postings = [customer(sender, "DEBIT", amount), customer(recipient, "CREDIT", amount)]
    else if (transaction.type === "DEPOSIT")
        postings = [cash("DEBIT", amount), customer(recipient, "CREDIT", amount)]
    else postings = [customer(sender, "DEBIT", amount), cash("CREDIT", amount)]
    await Journal.create(
        [
            {
                operationId: transaction._id.toString(),
                transactionId: transaction._id,
                description: transaction.type,
                performedBy: transaction.performedBy,
                postings
            }
        ],
        { session }
    )
}
module.exports = { initializeAccount, post }
