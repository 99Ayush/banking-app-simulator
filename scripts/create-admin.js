require("dotenv").config()
const mongoose = require("mongoose")
const User = require("../src/models/user")
const { z } = require("zod")
async function createAdmin() {
    const input = z
        .object({
            email: z.string().trim().toLowerCase().email(),
            password: z
                .string()
                .min(12)
                .refine((value) => Buffer.byteLength(value, "utf8") <= 72),
            name: z.string().min(2).default("Administrator")
        })
        .parse({
            email: process.env.BOOTSTRAP_ADMIN_EMAIL,
            password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
            name: process.env.BOOTSTRAP_ADMIN_NAME
        })
    await require("../src/config/db")()
    if (await User.exists({ email: input.email }))
        throw new Error("User already exists; refusing to overwrite or promote an account")
    await User.create({ ...input, role: "admin" })
    console.log("Administrator created")
}
if (require.main === module)
    createAdmin()
        .catch(() => {
            console.error("Administrator creation failed; verify inputs and database configuration")
            process.exitCode = 1
        })
        .finally(() => mongoose.disconnect())
module.exports = { createAdmin }
