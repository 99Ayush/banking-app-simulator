const mongoose = require("mongoose")
async function connectToDB() {
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI is missing")
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    for (const name of ["user", "account", "transaction", "beneficiary", "session", "journal"]) {
        require("../models/" + name)
    }
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()))
}
module.exports = connectToDB
