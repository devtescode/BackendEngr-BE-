const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const Userschema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    matric: {
      type: String,
      required: true,
      unique: true,
    },

    phoneNumber: {
      type: String,
      required: true,
      unique: true,
    },

    gender: {
      type: String,
      enum: ["Male", "Female"],
      required: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
    },

    role: {
      type: String,
      default: "student",
    },

    // Password reset — only the SHA-256 hash of the token is stored.
    passwordResetToken: {
      type: String,
      select: false,
      index: true,
    },

    passwordResetExpires: {
      type: Date,
      select: false,
    },

    // Set when a password is reset; JWTs issued before this are rejected.
    passwordChangedAt: {
      type: Date,
      select: false,
    },

    // Email verification. Legacy docs without this field are treated as
    // unverified (code checks `isEmailVerified !== true`).
    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    emailVerifiedAt: {
      type: Date,
    },

    // Only the SHA-256 hash of the verification token is stored.
    emailVerificationToken: {
      type: String,
      select: false,
      index: true,
    },

    emailVerificationExpires: {
      type: Date,
      select: false,
    },

    // Last successful verification email send (resend cooldown).
    emailVerificationSentAt: {
      type: Date,
      select: false,
    },
  },
  {timestamps: true}
);

Userschema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

Userschema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  delete user.passwordResetToken;
  delete user.passwordResetExpires;
  delete user.passwordChangedAt;
  delete user.emailVerificationToken;
  delete user.emailVerificationExpires;
  delete user.emailVerificationSentAt;
  return user;
};

module.exports = mongoose.model("User", Userschema);