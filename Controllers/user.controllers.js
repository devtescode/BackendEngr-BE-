const jwt = require("jsonwebtoken")
const env = require("dotenv")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const crypto = require("crypto")
const User = require("../Models/user.models");
const { sendEmail, isEmailConfigured } = require("../utils/email");
env.config()

const RESET_TOKEN_TTL_MINUTES = 30;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FORGOT_PASSWORD_MESSAGE =
    "If an account exists for that email, a password reset link has been sent.";

const hashResetToken = (token) =>
    crypto.createHash("sha256").update(token).digest("hex");

// Reset tokens are 64 hex chars (32 random bytes).
const isWellFormedResetToken = (token) =>
    typeof token === "string" && /^[a-f0-9]{64}$/.test(token);

const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[char]);

function buildResetEmail({ fullName, resetUrl }) {
    const name = escapeHtml(fullName || "there");
    const url = escapeHtml(resetUrl);

    const html = `
<div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:32px 16px;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;border:1px solid #e2e8f0;">
    <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">Reset your password</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569;">Hi ${name},</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475569;">
      We received a request to reset the password for your EU Hardwarestore account.
      Click the button below to choose a new password. This link expires in
      ${RESET_TOKEN_TTL_MINUTES} minutes and can only be used once.
    </p>
    <a href="${url}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px;">Reset Password</a>
    <p style="margin:24px 0 8px;font-size:13px;line-height:1.6;color:#64748b;">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 24px;font-size:13px;word-break:break-all;"><a href="${url}" style="color:#2563eb;">${url}</a></p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
      If you didn't request a password reset, you can safely ignore this email — your password won't change.
    </p>
  </div>
</div>`;

    const text = [
        `Hi ${fullName || "there"},`,
        "",
        "We received a request to reset the password for your EU Hardwarestore account.",
        `Open this link to choose a new password (expires in ${RESET_TOKEN_TTL_MINUTES} minutes, single use):`,
        resetUrl,
        "",
        "If you didn't request a password reset, you can ignore this email.",
    ].join("\n");

    return { html, text };
}




module.exports.userwelcome = async (req, res) => {
    res.status(200).json({ message: "Welcome to Engineering Backend" })
}

module.exports.usersignup = async (req, res) => {
    try {
        const {
            fullName,
            email,
            matric,
            gender,
            phoneNumber,
            password,
        } = req.body;

        const existingUser = await User.findOne({
            $or: [
                { email },
                { matric },
                { phoneNumber },
            ],
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User already exists",
            });
        }

        const user = await User.create({
            fullName,
            email,
            matric,
            gender,
            phoneNumber,
            password,
        });

        res.status(201).json({
            success: true,
            message: "Registration successful",
            user,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
}

module.exports.userlogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. validate input
        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required",
            });
        }

        // 2. find user
        const user = await User.findOne({ email }).select("+passwordChangedAt");
        if (!user) {
            return res.status(404).json({
                message: "User not found",
            });
        }

        // 3. compare password (hashed in DB)
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({
                message: "Invalid credentials",
            });
        }

        // 4. generate token
        const token = jwt.sign(
            {
                id: user._id,
                email: user.email,
                role: user.role,
                // Password version — verifyToken rejects the token once
                // a password reset changes this value.
                pwdv: user.passwordChangedAt ? user.passwordChangedAt.getTime() : 0,
            },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        // 5. response
        return res.status(200).json({
            message: "Login successful",
            token,
            user: {
                id: user._id,
                fullName: user.fullName,
                email: user.email,
                matric: user.matric,
                phoneNumber: user.phoneNumber,
                gender: user.gender,
                role: user.role,
            },
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            message: "Server error",
        });
    }
}

module.exports.changepassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                message: "Unauthorized",
            });
        }

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                message: "Current and new password are required",
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                message: "New password must be at least 8 characters long",
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                message: "User not found",
            });
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({
                message: "Current password is incorrect",
            });
        }

        user.password = newPassword;
        await user.save();

        return res.status(200).json({
            message: "Password changed successfully",
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            message: "Server error",
        });
    }
}
module.exports.forgotpassword = async (req, res) => {
    const email = typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
        return res.status(400).json({
            success: false,
            message: "Please provide a valid email address",
        });
    }

    // Checked before the user lookup so the response is the same
    // for every address when email delivery is unavailable.
    if (!isEmailConfigured() || !process.env.FRONTEND_URL) {
        console.error("Forgot password: email provider (EMAIL_PROVIDER + its credentials) or FRONTEND_URL is not set");
        return res.status(503).json({
            success: false,
            message: "Password reset is temporarily unavailable. Please try again later.",
        });
    }

    let user;

    try {
        user = await User.findOne({ email });

        if (!user) {
            return res.status(200).json({
                success: true,
                message: FORGOT_PASSWORD_MESSAGE,
            });
        }

        const token = crypto.randomBytes(32).toString("hex");

        // Issuing a new token replaces any earlier one, so only
        // the most recent link works.
        await User.updateOne(
            { _id: user._id },
            {
                $set: {
                    passwordResetToken: hashResetToken(token),
                    passwordResetExpires: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
                },
            }
        );

        const frontendUrl = process.env.FRONTEND_URL.replace(/\/+$/, "");
        const resetUrl = `${frontendUrl}/reset-password/${token}`;
        const { html, text } = buildResetEmail({ fullName: user.fullName, resetUrl });

        await sendEmail({
            to: user.email,
            subject: "Reset your EU Hardwarestore password",
            html,
            text,
            tags: ["password-reset"],
            idempotencyKey: crypto.randomUUID(),
        });

        return res.status(200).json({
            success: true,
            message: FORGOT_PASSWORD_MESSAGE,
        });
    } catch (error) {
        // Never log the token, the email body or the API key.
        console.error("Forgot password failed:", {
            name: error.name,
            status: error.status,
            code: error.code,
        });

        // The link was never delivered, so don't leave a live token behind.
        if (user) {
            await User.updateOne(
                { _id: user._id },
                { $unset: { passwordResetToken: 1, passwordResetExpires: 1 } }
            ).catch(() => { });
        }

        return res.status(503).json({
            success: false,
            message: "We couldn't send the reset email right now. Please try again in a few minutes.",
        });
    }
}

// Lets the reset page show an "invalid" or "expired" state
// before the user types a new password. Does not consume the token.
module.exports.validateresettoken = async (req, res) => {
    try {
        const { token } = req.params;

        if (!isWellFormedResetToken(token)) {
            return res.status(400).json({
                success: false,
                code: "TOKEN_INVALID",
                message: "This password reset link is invalid.",
            });
        }

        const user = await User.findOne({ passwordResetToken: hashResetToken(token) })
            .select("+passwordResetExpires");

        if (!user) {
            return res.status(400).json({
                success: false,
                code: "TOKEN_INVALID",
                message: "This password reset link is invalid or has already been used.",
            });
        }

        if (!user.passwordResetExpires || user.passwordResetExpires.getTime() <= Date.now()) {
            return res.status(400).json({
                success: false,
                code: "TOKEN_EXPIRED",
                message: "This password reset link has expired.",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Reset link is valid",
        });
    } catch (error) {
        console.error("Validate reset token failed:", error.name);
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
}

module.exports.resetpassword = async (req, res) => {
    try {
        const { token } = req.params;
        const { password, confirmPassword } = req.body || {};

        if (!isWellFormedResetToken(token)) {
            return res.status(400).json({
                success: false,
                code: "TOKEN_INVALID",
                message: "This password reset link is invalid.",
            });
        }

        if (typeof password !== "string" || !password) {
            return res.status(400).json({
                success: false,
                message: "New password is required",
            });
        }

        if (password.length < PASSWORD_MIN_LENGTH) {
            return res.status(400).json({
                success: false,
                message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
            });
        }

        if (password.length > PASSWORD_MAX_LENGTH) {
            return res.status(400).json({
                success: false,
                message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters long`,
            });
        }

        if (confirmPassword !== undefined && confirmPassword !== password) {
            return res.status(400).json({
                success: false,
                message: "Passwords do not match",
            });
        }

        const tokenHash = hashResetToken(token);

        // Atomically claim the token so it can only ever be used once,
        // even if two requests arrive at the same time.
        const user = await User.findOneAndUpdate(
            {
                passwordResetToken: tokenHash,
                passwordResetExpires: { $gt: new Date() },
            },
            { $unset: { passwordResetToken: 1, passwordResetExpires: 1 } },
            { returnDocument: "after" }
        );

        if (!user) {
            const expired = await User.findOneAndUpdate(
                { passwordResetToken: tokenHash },
                { $unset: { passwordResetToken: 1, passwordResetExpires: 1 } }
            );

            return res.status(400).json({
                success: false,
                code: expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
                message: expired
                    ? "This password reset link has expired. Please request a new one."
                    : "This password reset link is invalid or has already been used.",
            });
        }

        // Hashed by the pre-save hook. passwordChangedAt makes
        // verifyToken reject every JWT issued before this moment.
        user.password = password;
        user.passwordChangedAt = new Date();
        await user.save();

        return res.status(200).json({
            success: true,
            message: "Your password has been reset. You can now sign in with your new password.",
        });
    } catch (error) {
        console.error("Reset password failed:", error.name);
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
}
