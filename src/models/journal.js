const mongoose = require("mongoose")
const { AppError } = require("../errors/app-error")
const posting = new mongoose.Schema(
    {
        ledgerAccount: { type: String, required: true },
        accountId: { type: mongoose.Schema.Types.ObjectId, ref: "account" },
        kind: { type: String, enum: ["ASSET", "LIABILITY"], required: true },
        normalSide: { type: String, enum: ["DEBIT", "CREDIT"], required: true },
        side: { type: String, enum: ["DEBIT", "CREDIT"], required: true },
        amount: { type: Number, required: true, validate: (v) => Number.isSafeInteger(v) && v > 0 }
    },
    { _id: false }
)
const schema = new mongoose.Schema(
    {
        operationId: { type: String, required: true, unique: true, immutable: true },
        transactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "transaction",
            immutable: true
        },
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "user", immutable: true },
        description: { type: String, required: true, immutable: true },
        postings: {
            type: [posting],
            required: true,
            immutable: true,
            validate: {
                validator: (rows) =>
                    rows.length >= 2 &&
                    rows.reduce(
                        (sum, row) =>
                            sum + (row.side === "DEBIT" ? BigInt(row.amount) : -BigInt(row.amount)),
                        0n
                    ) === 0n,
                message: "Journal debits and credits must balance"
            }
        },
        createdAt: { type: Date, default: Date.now, immutable: true }
    },
    { versionKey: false }
)
schema.index({ "postings.accountId": 1, createdAt: -1 })
const immutable = () => {
    throw new AppError("Journal entries are append-only", 409, "IMMUTABLE_LEDGER")
}
schema.pre("save", function () {
    if (!this.isNew) immutable()
})
schema.pre("deleteOne", { document: true, query: false }, immutable)
for (const method of [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "findOneAndReplace",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
    "bulkWrite",
    "insertMany"
])
    schema.pre(method, immutable)
module.exports = mongoose.model("journal", schema)
