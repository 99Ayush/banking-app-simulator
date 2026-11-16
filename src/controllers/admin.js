const adminService = require("../services/admin")

async function getAllUsersController(req, res, next) {
    try {
        const { page, limit } = req.query
        const result = await adminService.getAllUsers({
            page: page ? parseInt(page, 10) : 1,
            limit: limit ? parseInt(limit, 10) : 50
        })

        return res.status(200).json({
            success: true,
            status: 200,
            data: result
        })
    } catch (err) {
        next(err)
    }
}

async function getAllAccountsController(req, res, next) {
    try {
        const { page, limit } = req.query
        const result = await adminService.getAllAccounts({
            page: page ? parseInt(page, 10) : 1,
            limit: limit ? parseInt(limit, 10) : 50
        })

        return res.status(200).json({
            success: true,
            status: 200,
            data: result
        })
    } catch (err) {
        next(err)
    }
}

async function getFailedTransfersController(req, res, next) {
    try {
        const { page, limit } = req.query
        const result = await adminService.getFailedTransfers({
            page: page ? parseInt(page, 10) : 1,
            limit: limit ? parseInt(limit, 10) : 50
        })

        return res.status(200).json({
            success: true,
            status: 200,
            data: result
        })
    } catch (err) {
        next(err)
    }
}

module.exports = {
    getAllUsersController,
    getAllAccountsController,
    getFailedTransfersController
}
