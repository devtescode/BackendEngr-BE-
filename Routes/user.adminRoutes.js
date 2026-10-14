const express = require("express");
const router = express.Router();

const {
  adminExists,
  registerAdmin,
  loginAdmin,
  getAllUsers,
} = require("../Controllers/admin.controllers");

const {
  createComponent,
  getComponents,
  deleteComponent,
  updateComponent,
  getComponent,
  getAllCarts,
} = require("../Controllers/componentController");

const {
  searchOrders,
  updatePickupStatus,
  getCollectedOrders
} = require("../Controllers/pickup.controller");

const upload = require("../middleware/upload");
const { verifyAdminToken } = require("../middleware/adminAuth");
// =====================================================
// AUTH
// =====================================================
router.get("/exists", adminExists);
router.post("/register", registerAdmin);
router.post("/login", loginAdmin);

// =====================================================
// COMPONENTS
// =====================================================
router.post(
  "/create-components",
  verifyAdminToken,
  upload.single("image"),
  createComponent
);

router.get("/getcomponents", getComponents);

router.delete(
  "/delete-component/:id",
  verifyAdminToken,
  deleteComponent
);

router.put(
  "/update-component/:id",
  verifyAdminToken,
  upload.single("image"),
  updateComponent
);

router.get("/getonecomponent/:id", getComponent);

// =====================================================
// CARTS & USERS
// =====================================================
router.get("/getallcarts", verifyAdminToken, getAllCarts);
router.get("/getallusers", verifyAdminToken, getAllUsers);

// =====================================================
// STUDENT PICKUP (role checked inside controller)
// =====================================================
router.get("/pickup/search", verifyAdminToken, searchOrders);
router.put("/pickup/:id/status", verifyAdminToken, updatePickupStatus);
router.get(
  "/pickup/collected",
  verifyAdminToken,
  getCollectedOrders
);


module.exports = router;