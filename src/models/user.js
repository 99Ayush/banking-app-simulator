const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")

const UserSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            trim: true,
            unique: true,
            lowercase: true,
            required: [true, "email is required for creating an user"],
            match: [
                /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
                "Please enter a valid email address"
            ]
        },
        name: {
            type: String,
            trim: true,
            required: [true, "name is required for creating an account"]
        },
        password: {
            type: String,
            required: [true, "password is required for creating an account"],
            minlength: [8, "password should be of 8 length"],
            select: false
        },
        role: {
            type: String,
            enum: ["user", "admin"],
            default: "user"
        },
        tokenVersion: { type: Number, default: 0 },
        failedLoginAttempts: {
            type: Number,
            default: 0
        },
        lockUntil: {
            type: Date
        },
        refreshTokenHash: {
            type: String,
            select: false
        }
    },
    {
        timestamps: true
    }
)

UserSchema.pre("save", async function () {
    if (!this.isModified("password")) return

    const salt = await bcrypt.genSalt(10)
    this.password = await bcrypt.hash(this.password, salt)
})

UserSchema.methods.comparepassword = async function (password) {
    return await bcrypt.compare(password, this.password)
}

UserSchema.methods.isLocked = function () {
    return !!(this.lockUntil && this.lockUntil > Date.now())
}

module.exports = mongoose.model("user", UserSchema)
