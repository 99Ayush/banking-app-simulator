const { z } = require("zod")

const objectIdSchema = z
    .string({ error: "Recipient account ID is required" })
    .regex(/^[a-fA-F0-9]{24}$/, "Recipient account ID must be a valid MongoDB ObjectId")

const transferSchema = z
    .object({
        toAccountId: objectIdSchema,
        senderAccountId: objectIdSchema.optional(),
        amount: z
            .number({ error: "Amount must be a number" })
            .int("Amount must be a whole number")
            .positive("Amount must be greater than 0")
            .max(1000000000000),
        idempotencyKey: z.string().trim().min(4).max(128).optional()
    })
    .strict()

const positiveQueryInteger = z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().positive())
const paginationFields = {
    page: positiveQueryInteger
        .pipe(z.number().max(Math.floor(Number.MAX_SAFE_INTEGER / 100)))
        .optional(),
    limit: positiveQueryInteger.transform((v) => Math.min(100, v)).optional()
}
const dateFields = {
    sort: z.enum(["asc", "desc"]).optional(),
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).optional()
}
const orderedDates = (value) =>
    !value.startDate || !value.endDate || new Date(value.startDate) <= new Date(value.endDate)
const paginationQuerySchema = z.object(paginationFields).strict()
const journalQuerySchema = z
    .object({ ...paginationFields, ...dateFields })
    .strict()
    .refine(orderedDates, { message: "startDate must precede endDate" })
const balanceQuerySchema = z.object({ accountId: objectIdSchema.optional() }).strict()
const transactionHistoryQuerySchema = z
    .object({
        ...paginationFields,
        ...dateFields,
        status: z.enum(["PENDING", "COMPLETED", "FAILED"]).optional(),
        type: z.enum(["TRANSFER", "DEPOSIT", "WITHDRAWAL"]).optional(),
        accountId: z
            .string()
            .regex(/^[a-fA-F0-9]{24}$/)
            .optional()
    })
    .strict()
    .refine(orderedDates, { message: "startDate must precede endDate" })

module.exports = {
    objectIdSchema,
    transferSchema,
    transactionHistoryQuerySchema,
    paginationQuerySchema,
    journalQuerySchema,
    balanceQuerySchema
}
