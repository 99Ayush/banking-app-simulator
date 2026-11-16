const beneficiaryService = require("../services/beneficiary")

async function addBeneficiaryController(req, res, next) {
    try {
        const userId = req.user._id
        const { accountNumber, name, email, nickname } = req.body

        const beneficiary = await beneficiaryService.addBeneficiary(userId, {
            accountNumber,
            name,
            email,
            nickname
        })

        return res.status(201).json({
            success: true,
            status: 201,
            message: "Beneficiary added successfully",
            data: { beneficiary }
        })
    } catch (err) {
        next(err)
    }
}

async function listBeneficiariesController(req, res, next) {
    try {
        const userId = req.user._id
        const beneficiaries = await beneficiaryService.listBeneficiaries(userId)

        return res.status(200).json({
            success: true,
            status: 200,
            data: { beneficiaries }
        })
    } catch (err) {
        next(err)
    }
}

async function verifyBeneficiaryController(req, res, next) {
    try {
        const userId = req.user._id
        const beneficiaryId = req.params.id

        const beneficiary = await beneficiaryService.verifyBeneficiary(userId, beneficiaryId)

        return res.status(200).json({
            success: true,
            status: 200,
            message: "Beneficiary verified successfully",
            data: { beneficiary }
        })
    } catch (err) {
        next(err)
    }
}

async function removeBeneficiaryController(req, res, next) {
    try {
        const userId = req.user._id
        const beneficiaryId = req.params.id

        const result = await beneficiaryService.removeBeneficiary(userId, beneficiaryId)

        return res.status(200).json({
            success: true,
            status: 200,
            message: result.message
        })
    } catch (err) {
        next(err)
    }
}

module.exports = {
    addBeneficiaryController,
    listBeneficiariesController,
    verifyBeneficiaryController,
    removeBeneficiaryController
}
