const jwt = require("jsonwebtoken")
const env = require("dotenv")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const crypto = require("crypto")
const User = require("../Models/user.models");
const { sendEmail, isEmailConfigured } = require("../utils/email");
const uploadImage = require("../utils/uploadImage");
const { deleteImage } = uploadImage;
env.config()

const PROFILE_IMAGE_FOLDER = "euhardwarestore-profile-images";

const RESET_TOKEN_TTL_MINUTES = 30;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FORGOT_PASSWORD_MESSAGE =
    "A password reset link has been sent to your email.";

const normalizeEmail = (value) =>
    typeof value === "string" ? value.trim().toLowerCase() : "";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Case-insensitive and whitespace-tolerant, so accounts saved before
// emails were normalised (mixed case, stray spaces) still match.
const findUserByEmail = (email) =>
    User.findOne({ email: { $regex: `^\\s*${escapeRegex(email)}\\s*$`, $options: "i" } });

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

const VERIFICATION_TOKEN_TTL_HOURS = 24;
const RESEND_COOLDOWN_SECONDS = 60;

const VERIFICATION_RESENT_BODY = {
    success: true,
    code: "VERIFICATION_RESENT",
    message: "If an unverified account exists for that email, a new verification link has been sent.",
    retryAfterSeconds: RESEND_COOLDOWN_SECONDS,
};

const isValidEmail = (email) =>
    Boolean(email) && email.length <= 254 && EMAIL_PATTERN.test(email);

// Returns the raw token (goes in the link only) and the hash + expiry to store.
function issueVerificationToken() {
    const rawToken = crypto.randomBytes(32).toString("hex");
    return {
        rawToken,
        tokenHash: hashResetToken(rawToken),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000),
    };
}

const isVerificationEmailConfigured = () =>
    isEmailConfigured() && Boolean(process.env.FRONTEND_URL);

function buildVerificationEmail({ fullName, verifyUrl }) {
    const name = escapeHtml(fullName || "there");
    const url = escapeHtml(verifyUrl);

    const html = `
<div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:32px 16px;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;border:1px solid #e2e8f0;">
    <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">Verify your email address</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569;">Hi ${name},</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475569;">
      Thanks for creating an EU Hardwarestore account. Please confirm your email address
      by clicking the button below you must verify your email before you can log in.
      This link expires in ${VERIFICATION_TOKEN_TTL_HOURS} hours.
    </p>
    <a href="${url}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px;">Verify My Email</a>
    <p style="margin:24px 0 8px;font-size:13px;line-height:1.6;color:#64748b;">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 24px;font-size:13px;word-break:break-all;"><a href="${url}" style="color:#2563eb;">${url}</a></p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
      If you didn't create an account, you can safely ignore this email.
    </p>
  </div>
</div>`;

    const text = [
        `Hi ${fullName || "there"},`,
        "",
        "Thanks for creating an EU Hardwarestore account.",
        "You must verify your email address before you can log in.",
        `Open this link to verify your email (expires in ${VERIFICATION_TOKEN_TTL_HOURS} hours):`,
        verifyUrl,
        "",
        "If you didn't create an account, you can ignore this email.",
    ].join("\n");

    return { html, text };
}

// Throws if email isn't configured or the provider rejects the message.
async function sendVerificationEmail({ to, fullName, rawToken }) {
    if (!isVerificationEmailConfigured()) {
        const error = new Error("Email provider or FRONTEND_URL is not configured");
        error.code = "EMAIL_NOT_CONFIGURED";
        throw error;
    }

    const frontendUrl = process.env.FRONTEND_URL.replace(/\/+$/, "");
    const verifyUrl = `${frontendUrl}/verify-email/${rawToken}`;
    const { html, text } = buildVerificationEmail({ fullName, verifyUrl });

    await sendEmail({
        to,
        subject: "Verify your EU Hardwarestore email",
        html,
        text,
        tags: ["email-verification"],
        idempotencyKey: crypto.randomUUID(),
    });
}

const logError = (label, error) =>
    console.error(label, { name: error?.name, status: error?.status, code: error?.code });

const UNVERIFIED_ACCOUNT_TTL_DAYS = 7;

// Signups never verified within a week are released, so nobody can
// squat someone else's email, matric or phone number. Legacy accounts
// (no isEmailVerified field / no token) are never touched.
const purgeStaleUnverified = ({ email, matric, phoneNumber }) =>
    User.deleteMany({
        $or: [{ email }, { matric }, { phoneNumber }],
        isEmailVerified: false,
        emailVerificationToken: { $exists: true },
        createdAt: { $lt: new Date(Date.now() - UNVERIFIED_ACCOUNT_TTL_DAYS * 24 * 60 * 60 * 1000) },
    });

// Sends the 409 for an existing account (by email, then matric/phone).
// Returns true if a response was sent.
async function respondIfAccountExists(res, { email, matric, phoneNumber }) {
    await purgeStaleUnverified({ email, matric, phoneNumber });

    const byEmail = await findUserByEmail(email);

    if (byEmail) {
        if (byEmail.isEmailVerified !== true) {
            res.status(409).json({
                success: false,
                code: "EMAIL_NOT_VERIFIED",
                email: byEmail.email,
                message: "This email is already registered but hasn't been verified yet. Check your inbox or resend the verification email.",
            });
        } else {
            res.status(409).json({
                success: false,
                code: "ACCOUNT_EXISTS",
                message: "An account with this email already exists. Please log in.",
            });
        }
        return true;
    }

    // Matric first, then phone, so the client can point at the exact field.
    const fieldChecks = [
        { field: "matric", value: matric, message: "This matric number is already registered to another account." },
        { field: "phoneNumber", value: phoneNumber, message: "This phone number is already registered to another account." },
    ];

    for (const { field, value, message } of fieldChecks) {
        if (value === undefined || value === null || value === "") continue;
        const existing = await User.findOne({ [field]: value });
        if (existing) {
            res.status(409).json({
                success: false,
                code: "ACCOUNT_EXISTS",
                field,
                message,
            });
            return true;
        }
    }

    return false;
}

module.exports.userwelcome = async (req, res) => {
    res.status(200).json({ message: "Welcome to Engineering Backend" })
}

module.exports.usersignup = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const {
            fullName,
            gender,
            password,
        } = req.body;
        let { matric, phoneNumber } = req.body;

        if (!isValidEmail(email)) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid email address",
            });
        }

        // Rejects objects like {"$regex": ...} before they reach a query.
        if (![fullName, matric, gender, phoneNumber, password].every((value) => typeof value === "string" && value)) {
            return res.status(400).json({
                success: false,
                message: "All fields are required",
            });
        }

        // Normalize so formatting differences can't create near-duplicates.
        matric = matric.trim().toUpperCase();
        phoneNumber = phoneNumber.trim();

        if (!matric || !phoneNumber) {
            return res.status(400).json({
                success: false,
                message: "All fields are required",
            });
        }

        if (await respondIfAccountExists(res, { email, matric, phoneNumber })) return;

        const { rawToken, tokenHash, expiresAt } = issueVerificationToken();

        let user;
        try {
            // Password is hashed by the pre-save hook.
            user = await User.create({
                fullName,
                email,
                matric,
                gender,
                phoneNumber,
                password,
                isEmailVerified: false,
                emailVerificationToken: tokenHash,
                emailVerificationExpires: expiresAt,
            });
        } catch (error) {
            if (error && error.code === 11000) {
                // Lost a race with a concurrent signup — answer as if it already existed.
                if (await respondIfAccountExists(res, { email, matric, phoneNumber })) return;
                return res.status(409).json({
                    success: false,
                    code: "ACCOUNT_EXISTS",
                    message: "An account with these details already exists.",
                });
            }
            throw error;
        }

        try {
            await sendVerificationEmail({ to: user.email, fullName: user.fullName, rawToken });
        } catch (error) {
            // Never log the token or the email body.
            logError("Signup verification email failed:", error);
            return res.status(201).json({
                success: true,
                code: "VERIFICATION_EMAIL_FAILED",
                email: user.email,
                message: "Your account was created, but we couldn't send the verification email. Please use Resend.",
            });
        }

        // Only start the resend cooldown once the email actually went out.
        await User.updateOne(
            { _id: user._id },
            { $set: { emailVerificationSentAt: new Date() } }
        ).catch((error) => logError("Signup sentAt update failed:", error));

        return res.status(201).json({
            success: true,
            code: "VERIFICATION_SENT",
            email: user.email,
            message: "Your account was created. We've sent a verification link to your email — please verify your email before logging in.",
        });
    } catch (error) {
        if (error && error.name === "ValidationError") {
            return res.status(400).json({
                success: false,
                message: error.message,
            });
        }
        logError("Signup failed:", error);
        return res.status(500).json({
            success: false,
            message: "Server error. Please try again.",
        });
    }
}

module.exports.userlogin = async (req, res) => {
    try {
        const { password } = req.body;
        const email = normalizeEmail(req.body.email);

        // 1. validate input
        if (!email || typeof password !== "string" || !password) {
            return res.status(400).json({
                message: "Email and password are required",
            });
        }

        // 2. find user
        const user = await findUserByEmail(email).select("+passwordChangedAt");
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

        // Legacy accounts without the field count as unverified.
        if (user.isEmailVerified !== true) {
            return res.status(403).json({
                success: false,
                code: "EMAIL_NOT_VERIFIED",
                email: user.email,
                message: "Please verify your email address before logging in.",
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
                profileImageUrl: user.profileImageUrl || null,
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
    const email = normalizeEmail(req.body?.email);

    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
        return res.status(400).json({
            success: false,
            message: "Please provide a valid email address",
        });
    }

    let user;

    try {
        user = await findUserByEmail(email);
    } catch (error) {
        console.error("Forgot password lookup failed:", { name: error.name, code: error.code });
        return res.status(500).json({
            success: false,
            message: "Server error. Please try again.",
        });
    }

    if (!user) {
        return res.status(404).json({
            success: false,
            message: "No account found with that email address.",
        });
    }

    if (user.isEmailVerified !== true) {
        // Don't leave an old reset link usable on an unverified account.
        await User.updateOne(
            { _id: user._id },
            { $unset: { passwordResetToken: 1, passwordResetExpires: 1 } }
        ).catch((error) => logError("Forgot password stale token cleanup failed:", error));

        return res.status(403).json({
            success: false,
            code: "EMAIL_NOT_VERIFIED",
            email: user.email,
            message: "Please verify your email address before resetting your password.",
        });
    }

    if (!isEmailConfigured() || !process.env.FRONTEND_URL) {
        console.error("Forgot password: email provider (EMAIL_PROVIDER + its credentials) or FRONTEND_URL is not set");
        return res.status(503).json({
            success: false,
            message: "Password reset is temporarily unavailable. Please try again later.",
        });
    }

    try {

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
        await User.updateOne(
            { _id: user._id },
            { $unset: { passwordResetToken: 1, passwordResetExpires: 1 } }
        ).catch(() => { });

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

        if (user.isEmailVerified !== true) {
            await User.updateOne(
                { _id: user._id },
                { $unset: { passwordResetToken: 1, passwordResetExpires: 1 } }
            );

            return res.status(403).json({
                success: false,
                code: "EMAIL_NOT_VERIFIED",
                email: user.email,
                message: "Please verify your email address before resetting your password.",
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
                isEmailVerified: true,
            },
            { $unset: { passwordResetToken: 1, passwordResetExpires: 1 } },
            { returnDocument: "after" }
        );

        if (!user) {
            // Returns the document as it was before the token was removed.
            const expired = await User.findOneAndUpdate(
                { passwordResetToken: tokenHash },
                { $unset: { passwordResetToken: 1, passwordResetExpires: 1 } }
            );

            if (expired && expired.isEmailVerified !== true) {
                return res.status(403).json({
                    success: false,
                    code: "EMAIL_NOT_VERIFIED",
                    email: expired.email,
                    message: "Please verify your email address before resetting your password.",
                });
            }

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

// POST so link scanners / prefetchers can't consume the token.
module.exports.verifyemail = async (req, res) => {
    try {
        const { token } = req.params;

        if (!isWellFormedResetToken(token)) {
            return res.status(400).json({
                success: false,
                code: "TOKEN_INVALID",
                message: "This verification link is invalid.",
            });
        }

        const tokenHash = hashResetToken(token);
        const now = new Date();

        // The hash is kept after verification so re-opening the link
        // reports ALREADY_VERIFIED; it can't do anything else.
        const verified = await User.findOneAndUpdate(
            {
                emailVerificationToken: tokenHash,
                emailVerificationExpires: { $gt: now },
                isEmailVerified: { $ne: true },
            },
            {
                $set: { isEmailVerified: true, emailVerifiedAt: now },
                $unset: { emailVerificationExpires: 1, emailVerificationSentAt: 1 },
            },
            { returnDocument: "after" }
        );

        if (verified) {
            return res.status(200).json({
                success: true,
                code: "EMAIL_VERIFIED",
                message: "Your email has been verified. You can now log in.",
            });
        }

        const user = await User.findOne({ emailVerificationToken: tokenHash })
            .select("+emailVerificationExpires");

        if (user && user.isEmailVerified === true) {
            return res.status(200).json({
                success: true,
                code: "ALREADY_VERIFIED",
                message: "Your email is already verified. You can log in.",
            });
        }

        if (user && (!user.emailVerificationExpires || user.emailVerificationExpires.getTime() <= Date.now())) {
            return res.status(400).json({
                success: false,
                code: "TOKEN_EXPIRED",
                email: user.email,
                message: "This verification link has expired. Please request a new one.",
            });
        }

        return res.status(400).json({
            success: false,
            code: "TOKEN_INVALID",
            message: "This verification link is invalid or has been replaced by a newer one.",
        });
    } catch (error) {
        logError("Verify email failed:", error);
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
}

module.exports.resendverification = async (req, res) => {
    const email = normalizeEmail(req.body?.email);

    if (!isValidEmail(email)) {
        return res.status(400).json({
            success: false,
            message: "Please provide a valid email address",
        });
    }

    let user;

    try {
        user = await findUserByEmail(email);
    } catch (error) {
        logError("Resend verification lookup failed:", error);
        return res.status(500).json({
            success: false,
            message: "Server error. Please try again.",
        });
    }

    // Same answer whether the account is missing or already verified.
    if (!user || user.isEmailVerified === true) {
        return res.status(200).json(VERIFICATION_RESENT_BODY);
    }

    if (!isVerificationEmailConfigured()) {
        console.error("Resend verification: email provider (EMAIL_PROVIDER + its credentials) or FRONTEND_URL is not set");
        return res.status(503).json({
            success: false,
            code: "EMAIL_SEND_FAILED",
            message: "We couldn't send the verification email right now. Please try again in a few minutes.",
        });
    }

    let claimed;
    const { rawToken, tokenHash, expiresAt } = issueVerificationToken();

    try {
        const now = new Date();
        const cooldownCutoff = new Date(now.getTime() - RESEND_COOLDOWN_SECONDS * 1000);

        // Atomic cooldown claim: only one request per window can issue a token.
        claimed = await User.findOneAndUpdate(
            {
                _id: user._id,
                isEmailVerified: { $ne: true },
                $or: [
                    { emailVerificationSentAt: { $exists: false } },
                    { emailVerificationSentAt: null },
                    { emailVerificationSentAt: { $lte: cooldownCutoff } },
                ],
            },
            {
                $set: { emailVerificationSentAt: now },
            },
            { returnDocument: "after" }
        );

        if (!claimed) {
            const current = await User.findById(user._id).select("+emailVerificationSentAt");

            if (!current || current.isEmailVerified === true) {
                return res.status(200).json(VERIFICATION_RESENT_BODY);
            }

            const sentAt = current.emailVerificationSentAt ? current.emailVerificationSentAt.getTime() : Date.now();
            const remainingMs = sentAt + RESEND_COOLDOWN_SECONDS * 1000 - Date.now();
            const retryAfterSeconds = Math.min(
                RESEND_COOLDOWN_SECONDS,
                Math.max(1, Math.ceil(remainingMs / 1000))
            );

            return res.status(429).json({
                success: false,
                code: "RESEND_COOLDOWN",
                message: `Please wait ${retryAfterSeconds} seconds before requesting another verification email.`,
                retryAfterSeconds,
            });
        }
    } catch (error) {
        logError("Resend verification claim failed:", error);
        return res.status(500).json({
            success: false,
            message: "Server error. Please try again.",
        });
    }

    try {
        await sendVerificationEmail({ to: claimed.email, fullName: claimed.fullName, rawToken });
    } catch (error) {
        // Never log the token or the email body.
        logError("Resend verification email failed:", error);

        // Nothing was delivered, so let the user retry straight away.
        await User.updateOne(
            { _id: claimed._id },
            { $unset: { emailVerificationSentAt: 1 } }
        ).catch(() => { });

        return res.status(503).json({
            success: false,
            code: "EMAIL_SEND_FAILED",
            message: "We couldn't send the verification email right now. Please try again in a few minutes.",
        });
    }

    // Swap the token only once the new link was delivered, so a failed
    // send never invalidates the link the user already has.
    try {
        await User.updateOne(
            { _id: claimed._id, isEmailVerified: { $ne: true } },
            { $set: { emailVerificationToken: tokenHash, emailVerificationExpires: expiresAt } }
        );
    } catch (error) {
        logError("Resend verification token update failed:", error);
        return res.status(500).json({
            success: false,
            message: "Server error. Please try again.",
        });
    }

    return res.status(200).json(VERIFICATION_RESENT_BODY);
}

// Public profile shape shared by GET /profile and the upload response.
const toProfileUser = (user) => ({
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    matric: user.matric,
    phoneNumber: user.phoneNumber,
    gender: user.gender,
    role: user.role,
    profileImageUrl: user.profileImageUrl || null,
});

// Best-effort Cloudinary delete; failures are only logged.
const safeDeleteImage = async (publicId, label) => {
    try {
        await deleteImage(publicId);
    } catch (error) {
        logError(label, error);
    }
};

module.exports.getprofile = async (req, res) => {
    try {
        const user = await User.findById(req.user?.id).lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        return res.status(200).json({ success: true, user: toProfileUser(user) });
    } catch (error) {
        logError("Get profile failed:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
}

// Upload new image -> atomically save it (learning the previous public ID)
// -> delete the previous asset. The old asset is never removed before the
// new one is stored, and a failed save removes the just-uploaded asset.
module.exports.uploadprofileimage = async (req, res) => {
    const userId = req.user?.id;

    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
        return res.status(400).json({
            success: false,
            code: "INVALID_IMAGE",
            message: "Please choose an image to upload.",
        });
    }

    let uploaded;
    try {
        uploaded = await uploadImage(req.file.buffer, {
            folder: PROFILE_IMAGE_FOLDER,
            transformation: [{ width: 512, height: 512, crop: "fill", gravity: "face" }],
            resource_type: "image",
            // Re-encoded on upload, so only a plain raster image is ever stored.
            allowed_formats: ["jpg", "jpeg", "png", "webp"],
            format: "webp",
        });
    } catch (error) {
        logError("Profile image upload failed:", error);
        return res.status(502).json({
            success: false,
            code: "UPLOAD_FAILED",
            message: "Could not upload the image. Please try again.",
        });
    }

    const newPublicId = uploaded?.public_id;
    const newUrl = uploaded?.secure_url;

    if (!newPublicId || !newUrl) {
        if (newPublicId) await safeDeleteImage(newPublicId, "Profile image cleanup failed:");
        return res.status(502).json({
            success: false,
            code: "UPLOAD_FAILED",
            message: "Could not upload the image. Please try again.",
        });
    }

    let previous;
    try {
        previous = await User.findOneAndUpdate(
            { _id: userId },
            { $set: { profileImageUrl: newUrl, profileImagePublicId: newPublicId } },
            { returnDocument: "before" }
        ).select("+profileImagePublicId");
    } catch (error) {
        logError("Profile image save failed:", error);
        await safeDeleteImage(newPublicId, "Profile image cleanup failed:");
        return res.status(500).json({ success: false, message: "Server error" });
    }

    if (!previous) {
        await safeDeleteImage(newPublicId, "Profile image cleanup failed:");
        return res.status(404).json({ success: false, message: "User not found" });
    }

    const oldPublicId = previous.profileImagePublicId;
    if (oldPublicId && oldPublicId !== newPublicId) {
        // Fire-and-forget: never blocks or fails the response.
        safeDeleteImage(oldPublicId, "Old profile image delete failed:");
    }

    req.io?.emit("users:updated", { userId: String(previous._id) });

    const user = toProfileUser(previous);
    user.profileImageUrl = newUrl;

    return res.status(200).json({
        success: true,
        message: "Profile picture updated",
        profileImageUrl: newUrl,
        user,
    });
}
