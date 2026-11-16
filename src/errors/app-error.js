class AppError extends Error {
    constructor(message, statusCode = 500, code = "INTERNAL_SERVER_ERROR", errors = null) {
        super(message)
        this.name = this.constructor.name
        this.statusCode = statusCode
        this.status = statusCode
        this.code = code
        this.errors = errors
        Error.captureStackTrace(this, this.constructor)
    }
}

class BadRequestError extends AppError {
    constructor(message = "Bad request", code = "BAD_REQUEST", errors = null) {
        super(message, 400, code, errors)
    }
}

class UnauthorizedError extends AppError {
    constructor(message = "Unauthorized", code = "UNAUTHORIZED") {
        super(message, 401, code)
    }
}

class ForbiddenError extends AppError {
    constructor(message = "Forbidden", code = "FORBIDDEN") {
        super(message, 403, code)
    }
}

class NotFoundError extends AppError {
    constructor(message = "Resource not found", code = "NOT_FOUND") {
        super(message, 404, code)
    }
}

class ConflictError extends AppError {
    constructor(message = "Resource conflict", code = "CONFLICT") {
        super(message, 409, code)
    }
}

class ValidationError extends AppError {
    constructor(message = "Validation failed", errors = []) {
        super(message, 400, "VALIDATION_ERROR", errors)
    }
}

class InsufficientFundsError extends AppError {
    constructor(message = "Insufficient funds", code = "INSUFFICIENT_FUNDS") {
        super(message, 400, code)
    }
}

class AccountLockedError extends AppError {
    constructor(
        message = "Account is locked due to repeated failed login attempts",
        code = "ACCOUNT_LOCKED"
    ) {
        super(message, 423, code)
    }
}

module.exports = {
    AppError,
    BadRequestError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    ValidationError,
    InsufficientFundsError,
    AccountLockedError
}
