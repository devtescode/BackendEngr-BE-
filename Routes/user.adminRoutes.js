const express = require("express")
const { adminExists, registerAdmin, loginAdmin } = require("../Controllers/admin.controllers")
const { createComponent, getComponents, deleteComponent, updateComponent, getComponent } = require("../Controllers/componentController")
const upload = require("../middleware/upload");
const router = express.Router()



router.get("/exists", adminExists)
router.post("/register", registerAdmin)
router.post("/login", loginAdmin)
router.post("/create-components", upload.single("image"), createComponent)
router.get("/getcomponents", getComponents)
router.delete("/delete-component/:id", deleteComponent)
router.put("/update-component/:id", upload.single("image"), updateComponent)
router.get("/getonecomponent/:id", getComponent)
// router.delete("/:id", deleteComponent);
// router.get("/:id", getComponent);


module.exports = router