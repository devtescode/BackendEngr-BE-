const express = require("express")
const { usersignup, userlogin } = require("../Controllers/user.controllers")
const router = express.Router()
const upload = require("../middleware/upload");

router.post("/usersignup", usersignup)
router.post("/userlogin", userlogin)
// router.post("/login", login)





module.exports = router