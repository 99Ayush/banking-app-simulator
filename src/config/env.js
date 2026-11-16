const { z } = require("zod")
const integer = (min, max, defaultValue) =>
    z
        .string()
        .regex(/^\d+$/)
        .default(String(defaultValue))
        .transform(Number)
        .pipe(z.number().int().min(min).max(max))
const envSchema = z
    .object({
        NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
        PORT: integer(1, 65535, 3000),
        MONGO_URI: z.string().regex(/^mongodb(\+srv)?:\/\//),
        REDIS_URL: z.string().regex(/^rediss?:\/\//),
        JWT_SECRET: z.string().min(32),
        JWT_REFRESH_SECRET: z.string().min(32),
        CLIENT_URL: z.string().url().default("http://localhost:3000"),
        BANK_TIMEZONE: z
            .string()
            .default("Asia/Kolkata")
            .refine((value) => {
                try {
                    new Intl.DateTimeFormat("en", { timeZone: value })
                    return true
                } catch (_err) {
                    return false
                }
            }, "Invalid IANA timezone"),
        DAILY_TRANSFER_LIMIT_PAISE: integer(1, 1000000000000, 10000000),
        // Self-service funding must be opted into explicitly. An unset value means
        // "off", so a misconfigured deployment cannot mint money by accident.
        SANDBOX_DEPOSITS_ENABLED: z.enum(["true", "false"]).default("false"),
        TRUST_PROXY_HOPS: integer(0, 5, 0)
    })
    .superRefine((env, ctx) => {
        if (env.JWT_SECRET === env.JWT_REFRESH_SECRET)
            ctx.addIssue({
                code: "custom",
                path: ["JWT_REFRESH_SECRET"],
                message: "Use distinct signing secrets"
            })
        if (env.NODE_ENV === "production") {
            for (const key of ["JWT_SECRET", "JWT_REFRESH_SECRET"])
                if (/super_secret|change.?me|example|placeholder|replace_with/i.test(env[key])) {
                    ctx.addIssue({
                        code: "custom",
                        path: [key],
                        message: "Replace example secrets before production"
                    })
                }
            if (env.SANDBOX_DEPOSITS_ENABLED === "true")
                ctx.addIssue({
                    code: "custom",
                    path: ["SANDBOX_DEPOSITS_ENABLED"],
                    message: "Disable sandbox deposits in production"
                })
            if (!env.CLIENT_URL.startsWith("https://"))
                ctx.addIssue({
                    code: "custom",
                    path: ["CLIENT_URL"],
                    message: "Production cookie clients require HTTPS"
                })
        }
    })
function validateEnv() {
    const parsed = envSchema.safeParse(process.env)
    if (!parsed.success)
        throw new Error(
            "Environment validation failed: " +
                parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")
        )
    for (const [key, value] of Object.entries(parsed.data)) process.env[key] = String(value)
    return parsed.data
}
module.exports = { validateEnv, envSchema }
