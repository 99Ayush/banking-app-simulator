function validate(schema, source = "body") {
    return (req, res, next) => {
        const target = req[source]
        const result = schema.safeParse(target)

        if (!result.success) {
            const formattedErrors = result.error.issues.map((issue) => ({
                field: issue.path.join(".") || source,
                message: issue.message
            }))

            return res.status(400).json({
                success: false,
                status: 400,
                code: "VALIDATION_ERROR",
                requestId: req.id,
                message: "Validation failed",
                errors: formattedErrors
            })
        }

        Object.defineProperty(req, source, {
            value: result.data,
            writable: true,
            configurable: true
        })
        next()
    }
}

module.exports = { validate }
