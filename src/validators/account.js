const { z } = require("zod")

const createAccountSchema = z
    .object({
        accountType: z.enum(["SAVINGS", "CURRENT"]).default("SAVINGS").optional(),
        accountName: z
            .string()
            .trim()
            .min(2, "Account name must be at least 2 characters")
            .max(50)
            .optional()
    })
    .strict()

const depositWithdrawSchema = z
    .object({
        amount: z
            .number({ error: "Amount must be a number" })
            .int("Amount must be a whole number (in paise)")
            .positive("Amount must be greater than 0")
            .max(1000000000000),
        idempotencyKey: z.string().trim().min(4).max(128).optional()
    })
    .strict()

module.exports = {
    createAccountSchema,
    depositWithdrawSchema
}
