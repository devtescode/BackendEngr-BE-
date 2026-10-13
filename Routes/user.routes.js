const express = require("express")
const { usersignup, userlogin } = require("../Controllers/user.controllers")
const { addToCart, updateCartQuantity, removeFromCart, getCart } = require("../Controllers/cart.controller")
const { getMyOrders } = require("../Controllers/getmyorders")
const router = express.Router()
// const upload = require("../middleware/upload");
const { verifyToken } = require("../middleware/auth");

router.post("/usersignup", usersignup)
router.post("/userlogin", userlogin)
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
// router.get("/orders/:id", verifyToken, getOrderById);


module.exports = router