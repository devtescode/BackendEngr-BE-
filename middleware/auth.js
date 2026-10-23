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

  // Reject tokens minted before the user's last password reset
  // (their pwdv no longer matches), so a reset signs out every
  // existing session.
  if (decoded?.id) {
    let user;

    try {
      user = await User.findById(decoded.id)
        .select("+passwordChangedAt")
        .lean();
    } catch (err) {
      return res.status(500).json({
        message: "Server error",
      });
    }

    const currentVersion = user?.passwordChangedAt
      ? new Date(user.passwordChangedAt).getTime()
      : 0;

    if ((decoded.pwdv || 0) !== currentVersion) {
      return res.status(401).json({
        message: "Invalid or expired token",
      });
    }
  }

  // ✅ attach user to request (not admin)
  req.user = decoded;

  next();
};
