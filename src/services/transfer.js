const Account = require("../models/account")
const money = require("./money")
const { BadRequestError, NotFoundError } = require("../errors/app-error")
class TransferService {
    async executeTransfer({ userId, senderAccountId, toAccountId, amount, idempotencyKey }) {
        let sender
        if (senderAccountId) sender = await Account.findOne({ _id: senderAccountId, userId })
        else {
            const accounts = await Account.find({ userId, status: { $ne: "CLOSED" } }).limit(2)
            if (accounts.length > 1)
                throw new BadRequestError(
                    "senderAccountId is required when you have multiple accounts"
                )
            sender = accounts[0]
        }
        if (!sender) throw new NotFoundError("Sender account not found")
        return money.execute({
            userId,
            fromAccount: sender._id,
            toAccount: toAccountId,
            amount,
            type: "TRANSFER",
            idempotencyKey
        })
    }
}
module.exports = new TransferService()
