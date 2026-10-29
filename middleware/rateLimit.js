const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const tooManyRequests = (message) => (req, res, next, options) =>
  res
    .status(options.statusCode)
    .json({ success: false, code: "RATE_LIMITED", message });

// Forgot password: limits reset-email spam per client IP.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooManyRequests(
    "Too many password reset requests. Please try again in 15 minutes."
  ),
});

// Reset password + token validation: limits token guessing.
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooManyRequests(
    "Too many attempts. Please try again in 15 minutes."
  ),
});

// Signup: limits account creation / verification-email spam per client IP.
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooManyRequests(
    "Too many sign-up attempts. Please try again in 15 minutes."
  ),
});

// Email verification: limits verification token guessing.
const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooManyRequests(
    "Too many verification attempts. Please try again in 15 minutes."
  ),
});

// Resend verification: limits verification-email spam per client IP.
const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooManyRequests(
    "Too many verification email requests. Please try again in 15 minutes."
  ),
});

// Profile picture upload: limits Cloudinary upload spam per signed-in
// user (runs after verifyToken), so students sharing campus Wi-Fi
// don't share one allowance.
const profileImageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooManyRequests(
    "Too many profile picture uploads. Please try again in 15 minutes."
  ),
});

module.exports = {
  forgotPasswordLimiter,
  resetPasswordLimiter,
  signupLimiter,
  verifyEmailLimiter,
  resendVerificationLimiter,
  profileImageLimiter,
};
