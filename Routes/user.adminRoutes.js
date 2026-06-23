const express = require("express")
const { adminExists, registerAdmin, loginAdmin } = require("../Controllers/admin.controllers")
// const { getAllCarts, getAllOrders } = require("../Controllers/admin.cart.controllers");

const router = express.Router()


// router.get("/exists", adminController.adminExists);
// router.post("/register", adminController.registerAdmin);
// router.post("/login", adminController.loginAdmin);
router.get("/exists", adminExists)
router.post("/register", registerAdmin)
router.post("/login", loginAdmin)
// router.get("/dashboard-stats", dashboardstats);

// router.get("/carts", getAllCarts);
// router.get("/getorders", getAllOrders);


module.exports = router