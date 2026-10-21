const express = require("express")
const { usersignup, userlogin, changepassword } = require("../Controllers/user.controllers")
const { addToCart, updateCartQuantity, removeFromCart, getCart } = require("../Controllers/cart.controller")
const { getMyOrders, getOrderById } = require("../Controllers/getmyorders")
const { getuserOrdersdb, getCartuserdb} = require("../Controllers/getorderuserdb")
const { getPaginatedComponents } = require("../Controllers/componentController")

const router = express.Router()
// const upload = require("../middleware/upload");
const { verifyToken } = require("../middleware/auth");

router.post("/usersignup", usersignup)
router.post("/userlogin", userlogin)

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




module.exports = router