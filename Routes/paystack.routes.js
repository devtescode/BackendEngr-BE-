
const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/auth");

const {
  initializePayment,
  verifyPayment,
} = require("../Controllers/paystack.controller");

router.post("/initialize", verifyToken, initializePayment);
router.get("/verify", verifyToken, verifyPayment);

module.exports = router;
