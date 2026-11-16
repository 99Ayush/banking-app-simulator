const mongoose = require("mongoose")
const schema = new mongoose.Schema(
    {
        _id: { type: String, required: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
        refreshTokenHash: { type: String, required: true, select: false },
        expiresAt: { type: Date, required: true },
        revokedAt: { type: Date, default: null }
    },
    { timestamps: true }
)
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
module.exports = mongoose.model("session", schema)
