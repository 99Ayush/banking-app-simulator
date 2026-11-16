const mongoose = require("mongoose")

const BeneficiarySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: true,
            index: true
        },
        accountNumber: {
            type: String,
            required: true,
            trim: true
        },
        accountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "account",
            required: true
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            trim: true,
            lowercase: true
        },
        nickname: {
            type: String,
            trim: true
        },
        status: {
            type: String,
            enum: ["VERIFIED", "PENDING"],
            default: "VERIFIED"
        }
    },
    {
        timestamps: true
    }
)

BeneficiarySchema.index({ userId: 1, accountNumber: 1 }, { unique: true })

module.exports = mongoose.model("beneficiary", BeneficiarySchema)
