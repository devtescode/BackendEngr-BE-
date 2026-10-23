const { rateLimit } = require("express-rate-limit");

const tooManyRequests = (message) => (req, res, next, options) =>
  res.status(options.statusCode).json({ success: false, message });

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

module.exports = { forgotPasswordLimiter, resetPasswordLimiter };
