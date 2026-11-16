const { BadRequestError } = require("../errors/app-error")
const { z } = require("zod")
const keySchema = z.string().trim().min(4).max(128)
function idempotencyKey(req, res, next) {
    const header = req.headers["idempotency-key"],
        body = req.body?.idempotencyKey
    for (const value of [header, body].filter((v) => v !== undefined)) {
        if (!keySchema.safeParse(value).success)
            return next(new BadRequestError("Idempotency key must contain 4 to 128 characters"))
    }
    if (header !== undefined && body !== undefined && header.trim() !== body.trim())
        return next(new BadRequestError("Header and body idempotency keys differ"))
    req.idempotencyKey = (header || body)?.trim()
    next()
}
module.exports = { idempotencyKey }
