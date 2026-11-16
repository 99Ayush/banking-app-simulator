const { BadRequestError } = require("../errors/app-error")
const MAX_MONEY = 1000000000000
function validateAmount(amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_MONEY) {
        throw new BadRequestError(
            "Amount must be a positive whole number in paise, at most " + MAX_MONEY
        )
    }
}
function dayKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en", {
        timeZone: process.env.BANK_TIMEZONE || "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date)
    const get = (type) => parts.find((p) => p.type === type).value
    return get("year") + "-" + get("month") + "-" + get("day")
}
module.exports = { MAX_MONEY, validateAmount, dayKey }
