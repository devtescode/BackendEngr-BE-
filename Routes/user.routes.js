const express = require("express")
const {
    usersignup,
    userlogin,
    changepassword,
    forgotpassword,
    validateresettoken,
    resetpassword,
    verifyemail,
    resendverification,
    getprofile,
    uploadprofileimage,
} = require("../Controllers/user.controllers")
const {
    forgotPasswordLimiter,
    resetPasswordLimiter,
    signupLimiter,
    verifyEmailLimiter,
    resendVerificationLimiter,
    profileImageLimiter,
} = require("../middleware/rateLimit")
const profileImageUpload = require("../middleware/profileImageUpload")
const { addToCart, updateCartQuantity, removeFromCart, getCart } = require("../Controllers/cart.controller")
const { getMyOrders, getOrderById } = require("../Controllers/getmyorders")
const { getuserOrdersdb, getCartuserdb} = require("../Controllers/getorderuserdb")
const { getPaginatedComponents } = require("../Controllers/componentController")

const router = express.Router()
// const upload = require("../middleware/upload");
const { verifyToken } = require("../middleware/auth");

router.post("/usersignup", signupLimiter, usersignup)
router.post("/userlogin", userlogin)

// Email verification (public, rate limited). POST so link scanners can't consume tokens.
router.post("/verify-email/:token", verifyEmailLimiter, verifyemail)
router.post("/resend-verification", resendVerificationLimiter, resendverification)

// Password recovery (public, rate limited).
router.post("/forgot-password", forgotPasswordLimiter, forgotpassword)
router.get("/reset-password/:token", resetPasswordLimiter, validateresettoken)
router.post("/reset-password/:token", resetPasswordLimiter, resetpassword)

// Public component listing with server-side pagination.
router.get("/components", getPaginatedComponents)

router.post("/addtocart", verifyToken, addToCart)
router.put(
  "/cart/:componentId",
  verifyToken,
  updateCartQuantity
);

router.delete(
  "/cart/:componentId",
  verifyToken,
  removeFromCart
);

router.get(
  "/cart",
  verifyToken,
  getCart
);

router.get("/getorders", verifyToken, getMyOrders)
router.get("/orders/:id", verifyToken, getOrderById);


router.get("/userordersdb", verifyToken, getuserOrdersdb);
router.get("/cartuserdb", verifyToken, getCartuserdb);

router.post("/changepassword", verifyToken, changepassword);

// Profile + profile picture (multipart field "image", JPEG/PNG/WebP, max 5 MB).
router.get("/profile", verifyToken, getprofile);
router.post("/profile-image", verifyToken, profileImageLimiter, profileImageUpload, uploadprofileimage);




module.exports = router