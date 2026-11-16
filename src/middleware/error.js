// Centralized error handler
function errorHandler(err, req, res, _next) {
    let statusCode = err.statusCode || err.status || 500
    let code = err.code || "INTERNAL_SERVER_ERROR"
    let message = err.message || "An unexpected error occurred"
    let errors = err.errors || undefined

    // Handle Mongo duplicate key error (code 11000)
    if (err.code === 11000) {
        statusCode = 422
        code = "DUPLICATE_KEY_ERROR"
        const field = Object.keys(err.keyPattern || {})[0] || "field"
        message = `${field} already exists`
    }

    // Handle Mongo CastError (invalid ObjectId)
    if (err.name === "CastError") {
        statusCode = 400
        code = "INVALID_ID"
        message = `Invalid format for identifier: ${err.value}`
    }

    // Handle JSON syntax error from express.json()
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
        statusCode = 400
        code = "INVALID_JSON"
        message = "Malformed JSON in request body"
    }

    // Handle JWT errors
    if (err.name === "JsonWebTokenError") {
        statusCode = 401
        code = "INVALID_TOKEN"
        message = "unauthorized"
    }
    if (err.name === "TokenExpiredError") {
        statusCode = 401
        code = "TOKEN_EXPIRED"
        message = "unauthorized"
    }

    // Log unexpected 500 errors
    if (statusCode >= 500 && process.env.NODE_ENV !== "test") {
        console.error(
            JSON.stringify({
                level: "error",
                requestId: req.id,
                method: req.method,
                path: req.path,
                code
            })
        )
    }

    if (statusCode >= 500 && !err.statusCode) message = "An unexpected error occurred"
    const payload = {
        success: false,
        status: statusCode,
        code,
        message
    }

    if (err.data) payload.data = err.data
    if (req.id) payload.requestId = req.id
    if (errors && errors.length > 0) {
        payload.errors = errors
    }

    return res.status(statusCode).json(payload)
}

module.exports = { errorHandler }
