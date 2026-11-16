const { z } = require("zod")

const emailSchema = z
    .string({ error: "Email is required" })
    .trim()
    .toLowerCase()
    .email("Please provide a valid email address")

const passwordSchema = z
    .string({ error: "Password is required" })
    .min(8, "Password must be at least 8 characters long")
    .max(72, "Password must not exceed 72 characters")
    .refine(
        (value) => Buffer.byteLength(value, "utf8") <= 72,
        "Password must not exceed 72 UTF-8 bytes"
    )

const registerSchema = z
    .object({
        name: z
            .string({ error: "Name is required" })
            .trim()
            .min(2, "Name must be at least 2 characters long")
            .max(50, "Name must not exceed 50 characters"),
        email: emailSchema,
        password: passwordSchema
    })
    .strict()

const loginSchema = z
    .object({
        email: emailSchema,
        password: passwordSchema
    })
    .strict()

const logoutSchema = z.object({}).strict().optional()

const refreshTokenSchema = z
    .object({
        refreshToken: z.string().optional()
    })
    .strict()
    .optional()

module.exports = {
    registerSchema,
    loginSchema,
    logoutSchema,
    refreshTokenSchema,
    emailSchema,
    passwordSchema
}
