const { z } = require("zod")

const createBeneficiarySchema = z
    .object({
        accountNumber: z
            .string()
            .trim()
            .min(5, "Account number must be at least 5 characters")
            .max(30),
        name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
        email: z.string().trim().email("Invalid email").optional(),
        nickname: z.string().trim().max(50).optional()
    })
    .strict()

module.exports = {
    createBeneficiarySchema
}
