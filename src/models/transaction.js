const mongoose = require("mongoose")
const crypto = require("crypto")

function generateReferenceId() {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const randomPart = crypto.randomBytes(8).toString("hex").toUpperCase()
    return `TXN-${datePart}-${randomPart}`
}

const TransactionSchema = new mongoose.Schema(
    {
        referenceId: {
            type: String,
            unique: true,
            required: true,
            default: generateReferenceId
        },
        fromAccount: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "account"
        },
        toAccount: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "account",
            required: true
        },
        // Monetary amounts are strictly integer paise (1 INR = 100 paise)
        amount: {
            type: Number,
            required: true,
            validate: {
                validator: (val) => Number.isSafeInteger(val) && val > 0,
                message: "Amount must be a positive integer in paise"
            }
        },
        status: {
            type: String,
            enum: ["PENDING", "COMPLETED", "FAILED"],
            default: "PENDING"
        },
        type: {
            type: String,
            enum: ["TRANSFER", "DEPOSIT", "WITHDRAWAL"],
            required: true
        },
        idempotencyKey: {
            type: String,
            trim: true
        },
        legacyCheckpoint: { type: Boolean, default: false },
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
        initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
        requestAccount: { type: mongoose.Schema.Types.ObjectId, ref: "account" },
        requestFingerprint: { type: String },
        attemptCount: { type: Number, default: 0 },
        completedAt: { type: Date },
        failureStatus: { type: Number },
        failureCode: { type: String },
        failureReason: {
            type: String,
            trim: true
        }
    },
    {
        timestamps: true
    }
)

// Index 1: Fast queries for sender history ordered chronologically
TransactionSchema.index({ fromAccount: 1, createdAt: -1 })

// Index 2: Fast queries for recipient history ordered chronologically
TransactionSchema.index({ toAccount: 1, createdAt: -1 })

// Index 3: Filter transactions by status (e.g., admin queries for failed transfers)
TransactionSchema.index({ status: 1, createdAt: -1 })

// Index 4: Enforce unique idempotency per sender account
TransactionSchema.index(
    { requestAccount: 1, idempotencyKey: 1 },
    {
        name: "operation_idempotency",
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: "string" } }
    }
)

module.exports = mongoose.model("transaction", TransactionSchema)
