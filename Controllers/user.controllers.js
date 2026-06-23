const jwt = require("jsonwebtoken")
const env = require("dotenv")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const User = require("../Models/user.models");
env.config()




module.exports.userwelcome = async (req, res) => {
    res.status(200).json({ message: "Welcome to Engineering Backend" })
}

module.exports.usersignup = async (req, res) => {
    try {
        const {
            fullName,
            email,
            matric,
            gender,
            phoneNumber,
            password,
        } = req.body;

        const existingUser = await User.findOne({
            $or: [
                { email },
                { matric },
                { phoneNumber },
            ],
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User already exists",
            });
        }

        const user = await User.create({
            fullName,
            email,
            matric,
            gender,
            phoneNumber,
            password,
        });

        res.status(201).json({
            success: true,
            message: "Registration successful",
            user,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
}

module.exports.userlogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. validate input
        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required",
            });
        }

        // 2. find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({
                message: "User not found",
            });
        }

        // 3. compare password (hashed in DB)
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({
                message: "Invalid credentials",
            });
        }

        // 4. generate token
        const token = jwt.sign(
            {
                id: user._id,
                email: user.email,
                role: user.role,
            },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        // 5. response
        return res.status(200).json({
            message: "Login successful",
            token,
            user: {
                id: user._id,
                fullName: user.fullName,
                email: user.email,
                matric: user.matric,
                phoneNumber: user.phoneNumber,
                gender: user.gender,
                role: user.role,
            },
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            message: "Server error",
        });
    }
}