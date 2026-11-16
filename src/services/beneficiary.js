const mongoose = require("mongoose")
const beneficiaryModel = require("../models/beneficiary")
const accountModel = require("../models/account")
const { BadRequestError, NotFoundError, ConflictError } = require("../errors/app-error")

class BeneficiaryService {
    async addBeneficiary(userId, { accountNumber, name, email, nickname }) {
        // Verify account exists
        const targetAccount = await accountModel
            .findOne({ accountNumber, status: "ACTIVE" })
            .populate("userId", "name email")
        if (!targetAccount) {
            throw new NotFoundError("Target bank account not found with provided account number")
        }

        // Prevent adding own account as beneficiary
        if (targetAccount.userId._id.toString() === userId.toString()) {
            throw new BadRequestError("Cannot add your own account as a beneficiary")
        }

        if (email && email.toLowerCase() !== targetAccount.userId.email)
            throw new BadRequestError("Beneficiary email does not match the account owner")

        // Check if already added
        const existing = await beneficiaryModel.findOne({ userId, accountNumber })
        if (existing) {
            throw new ConflictError("Beneficiary with this account number already exists")
        }

        const beneficiary = await beneficiaryModel.create({
            userId,
            accountNumber,
            accountId: targetAccount._id,
            name,
            email,
            nickname,
            status: "VERIFIED"
        })

        return beneficiary
    }

    async listBeneficiaries(userId) {
        return beneficiaryModel.find({ userId }).populate("accountId", "accountType status")
    }

    async verifyBeneficiary(userId, beneficiaryId) {
        if (!mongoose.Types.ObjectId.isValid(beneficiaryId)) {
            throw new NotFoundError("Beneficiary not found")
        }

        const existing = await beneficiaryModel.findOne({ _id: beneficiaryId, userId })
        if (!existing) throw new NotFoundError("Beneficiary not found")
        const target = await accountModel
            .findOne({ _id: existing.accountId, status: "ACTIVE" })
            .populate("userId", "email")
        if (!target || (existing.email && existing.email !== target.userId.email))
            throw new BadRequestError("Beneficiary account verification failed")
        const beneficiary = await beneficiaryModel.findOneAndUpdate(
            { _id: beneficiaryId, userId },
            { $set: { status: "VERIFIED" } },
            { returnDocument: "after" }
        )

        if (!beneficiary) {
            throw new NotFoundError("Beneficiary not found")
        }

        return beneficiary
    }

    async removeBeneficiary(userId, beneficiaryId) {
        if (!mongoose.Types.ObjectId.isValid(beneficiaryId)) {
            throw new NotFoundError("Beneficiary not found")
        }

        const result = await beneficiaryModel.findOneAndDelete({ _id: beneficiaryId, userId })
        if (!result) {
            throw new NotFoundError("Beneficiary not found")
        }

        return { message: "Beneficiary removed successfully" }
    }
}

module.exports = new BeneficiaryService()
