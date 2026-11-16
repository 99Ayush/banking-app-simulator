require("dotenv").config()
const mongoose = require("mongoose")
const User = require("../src/models/user")
const Account = require("../src/models/account")
const Beneficiary = require("../src/models/beneficiary")
const accountService = require("../src/services/account")
async function seedDatabase() {
    if (process.env.NODE_ENV === "production")
        throw new Error("Seed is restricted to development or test databases")
    await require("../src/config/db")()
    const definitions = [
        ["System Admin", "admin@bank.com", "AdminPassword123!", "admin"],
        ["Alice Smith", "alice@example.com", "AlicePassword123!", "user"],
        ["Bob Jones", "bob@example.com", "BobPassword123!", "user"]
    ]
    const users = []
    for (const [name, email, password, role] of definitions) {
        const existing = await User.findOne({ email })
        if (existing && existing.role !== role)
            throw new Error(
                "Existing sample user has a different role; seed refuses to overwrite it"
            )
        users.push(existing || (await User.create({ name, email, password, role })))
    }
    const [, alice, bob] = users
    const accounts = []
    for (const [owner, accountNumber, accountType, accountName, amount] of [
        [alice, "ACC100000001", "SAVINGS", "Alice Savings", 100000],
        [alice, "ACC100000002", "CURRENT", "Alice Current", 500000],
        [bob, "ACC200000001", "SAVINGS", "Bob Savings", 250000]
    ]) {
        let account = await Account.findOne({ accountNumber }).select("+seedFundingPending")
        if (account && account.userId.toString() !== owner._id.toString())
            throw new Error("Sample account number belongs to another user")
        if (!account) {
            account = await Account.create({
                userId: owner._id,
                accountNumber,
                accountType,
                accountName,
                ledgerInitialized: true,
                seedFundingPending: true,
                balance: 0
            })
        }
        if (account.seedFundingPending) {
            await accountService.deposit(
                owner._id,
                account._id,
                amount,
                "seed-v2-" + accountNumber,
                true
            )
            await Account.updateOne({ _id: account._id }, { $set: { seedFundingPending: false } })
        }
        accounts.push(account)
    }
    await Beneficiary.updateOne(
        { userId: alice._id, accountNumber: accounts[2].accountNumber },
        {
            $setOnInsert: {
                accountId: accounts[2]._id,
                name: bob.name,
                email: bob.email,
                status: "VERIFIED"
            }
        },
        { upsert: true }
    )
    console.log(
        "Seed complete. Existing records were preserved. Sample credentials are listed in README.md."
    )
}
if (require.main === module)
    seedDatabase()
        .catch((err) => {
            console.error(err.message)
            process.exitCode = 1
        })
        .finally(() => mongoose.disconnect())
module.exports = { seedDatabase }
