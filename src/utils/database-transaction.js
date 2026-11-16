const mongoose = require("mongoose")
const { AppError } = require("../errors/app-error")
async function runTransaction(callback) {
    const session = await mongoose.startSession()
    try {
        // The driver retries uncertain commits on the SAME transaction. It retries the
        // callback only for TransientTransactionError, after the transaction is aborted.
        return await session.withTransaction(() => callback(session), {
            readConcern: { level: "snapshot" },
            writeConcern: { w: "majority" },
            readPreference: "primary",
            timeoutMS: 15000
        })
    } catch (err) {
        if (err.hasErrorLabel?.("UnknownTransactionCommitResult")) {
            throw new AppError(
                "Commit outcome is uncertain; retry the same operation identity",
                503,
                "COMMIT_UNCERTAIN"
            )
        }
        throw err
    } finally {
        await session.endSession()
    }
}
module.exports = { runTransaction }
