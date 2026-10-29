import jwt from "jsonwebtoken";
import User from "../Models/user.models.js";

export const verifyToken = async (req, res, next) => {
  let decoded;

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "No token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }

  // Every user token carries the account id.
  if (!decoded?.id) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }

  // Reject tokens minted before the user's last password reset
  // (their pwdv no longer matches), so a reset signs out every
  // existing session.
  let user;

  try {
    user = await User.findById(decoded.id)
      // isEmailVerified is selected by default; passwordChangedAt is hidden.
      .select("+passwordChangedAt")
      .lean();
  } catch (err) {
    return res.status(500).json({
      message: "Server error",
    });
  }

  // Account deleted since the token was issued.
  if (!user) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }

  const currentVersion = user.passwordChangedAt
    ? new Date(user.passwordChangedAt).getTime()
    : 0;

  if ((decoded.pwdv || 0) !== currentVersion) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }

  // Unverified (incl. legacy accounts without the field) can't use the API.
  if (user.isEmailVerified !== true) {
    return res.status(403).json({
      success: false,
      code: "EMAIL_NOT_VERIFIED",
      message: "Please verify your email address before continuing.",
    });
  }

  // ✅ attach user to request (not admin)
  req.user = decoded;

  next();
};
