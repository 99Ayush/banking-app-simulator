const express = require("express")
const beneficiaryController = require("../controllers/beneficiary")
const { protectRoute } = require("../middleware/auth")
const { validate } = require("../middleware/validate")
const { createBeneficiarySchema } = require("../validators/beneficiary")

const router = express.Router()

/*
 * POST /api/v1/beneficiaries
 */
router.post(
    "/",
    protectRoute,
    validate(createBeneficiarySchema),
    beneficiaryController.addBeneficiaryController
)

/*
 * GET /api/v1/beneficiaries
 */
router.get("/", protectRoute, beneficiaryController.listBeneficiariesController)

/*
 * PATCH /api/v1/beneficiaries/:id/verify
 */
router.patch("/:id/verify", protectRoute, beneficiaryController.verifyBeneficiaryController)

/*
 * DELETE /api/v1/beneficiaries/:id
 */
router.delete("/:id", protectRoute, beneficiaryController.removeBeneficiaryController)

module.exports = router
