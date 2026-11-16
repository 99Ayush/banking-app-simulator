const mongoose = require("mongoose")
const crypto = require("crypto")

const AccountSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: true,
            index: true
        },
        accountNumber: {
            type: String,
            unique: true,
            required: true,
            default: () => "ACC" + crypto.randomBytes(12).toString("hex").toUpperCase()
        },
        accountType: {
            type: String,
            enum: ["SAVINGS", "CURRENT"],
            default: "SAVINGS",
            required: true
        },
        accountName: {
            type: String,
            trim: true,
            default: "Primary Savings"
        },
        // Monetary amounts are strictly integer paise (1 INR = 100 paise)
        balance: {
            type: Number,
            default: 0,
            min: [0, "Balance cannot be negative"],
            max: 1000000000000,
            validate: {
                validator: Number.isSafeInteger,
                message: "Balance must be an integer (in paise)"
            }
        },
        dailyTransferLimit: {
            type: Number,
            min: 1,
            max: 1000000000000,
            default: 10000000, // 100,000 INR = 10,000,000 paise
            validate: {
                validator: Number.isSafeInteger,
                message: "Daily transfer limit must be an integer (in paise)"
            }
        },
        ledgerVersion: { type: Number, default: 0 },
        ledgerInitialized: { type: Boolean, default: false },
        seedFundingPending: { type: Boolean, default: false, select: false },
        transferDay: { type: String, default: "" },
        dailyTransferred: { type: Number, default: 0 },
        status: {
            type: String,
            enum: ["ACTIVE", "FROZEN", "CLOSED"],
            default: "ACTIVE"
        }
    },
    {
        timestamps: true
    }
)

AccountSchema.index({ userId: 1, accountType: 1 })

module.exports = mongoose.model("account", AccountSchema)
