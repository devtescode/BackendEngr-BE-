const Admin = require("../Models/admin.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const PaymentOrder  = require("../Models/paymentOrder");
const Component = require("../Models/component");
const User = require("../Models/user.models");

// =========================
// CHECK IF ADMIN EXISTS
// =========================
module.exports.adminExists = async (req, res) => {
  try {
    const admin = await Admin.findOne();

    return res.json({
      exists: !!admin,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Server error",
    });
  }
};


// =========================
// REGISTER ADMIN
// =========================
module.exports.registerAdmin = async (req, res) => {
  try {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const existing = await Admin.findOne({ email });

    if (existing) {
      return res.status(400).json({
        message: "Admin already exists",
      });
    }

    const admin = await Admin.create({
      email,
      username,
      password,
    });

    return res.status(201).json({
      message: "Admin created successfully",
      admin,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Server error",
    });
  }
};

// =========================
// LOGIN ADMIN
// =========================
module.exports.loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const admin = await Admin.findOne({ email });

    if (!admin) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      {
        id: admin._id,
        role: "admin",
        email: admin.email,
      },
      process.env.ADMIN_JWT_SECRET,
      { expiresIn: "1hr" }
    );
    // console.log("Admin logged in:", admin);
    // console.log("Admin logged in:", token);

    return res.json({
      message: "Login successful",
      token,
      admin,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Server error",
    });
  }
};


module.exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({})
      .select("-password")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      users,
    });
  } catch (error) {
    console.error(
      "Get all users error:",
      error
    );

    return res.status(500).json({
      message: "Failed to get users",
      error: error.message,
    });
  }
};





// ---------- OVERVIEW ----------


// ---------- OVERVIEW ----------
module.exports.overview = async (req, res) => {
  try {
    const [orders, components, userCount] = await Promise.all([
      PaymentOrder.find().sort({ createdAt: -1 }).lean(),
      Component.find().sort({ name: 1 }).lean(),
      User.countDocuments({ role: "student" }),
    ]);

    const normalize = (doc) => {
      if (!doc) return null;
      const { _id, __v, ...rest } = doc;
      return { id: String(_id), ...rest };
    };

    const normalizedOrders = orders.map((o) => {
      const order = normalize(o);

      // userId is a Mongo ObjectId — expose it as a string
      if (order.userId && order.userId._id) {
        order.userId = String(order.userId._id);
      } else if (order.userId) {
        order.userId = String(order.userId);
      }

      // amount is stored in KOBO — expose naira for display
      const kobo = Number(o.amount ?? 0);
      order.amountKobo = kobo;
      order.amountNaira = kobo / 100;

      // items: normalize componentId inside each line
      order.items = Array.isArray(o.items)
        ? o.items.map((it) => ({
            ...it,
            componentId:
              it.componentId && it.componentId._id
                ? String(it.componentId._id)
                : it.componentId
                ? String(it.componentId)
                : null,
            price: Number(it.price ?? 0),
            quantity: Number(it.quantity ?? 0),
          }))
        : [];

      return order;
    });

    res.json({
      orders: normalizedOrders,
      components: components.map((c) =>
        normalize({ ...c, stock: Number(c.stock ?? 0) })
      ),
      userCount,
    });
  } catch (err) {
    console.error("admin/overview:", err);
    res.status(500).json({ message: "Failed to load overview." });
  }
};