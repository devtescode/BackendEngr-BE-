const mongoose = require("mongoose");
const PaymentOrder = require("../Models/paymentOrder");
const User = require("../Models/user.models"); // adjust path to your User model



// =====================================================
// GUARD: ADMIN ONLY
// =====================================================
// verifyToken already set req.user. We just check
// the role here, so no separate isAdmin middleware
// is needed.
//
function requireAdmin(req, res) {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized." });
    return false;
  }

  if (req.user.role !== "admin") {
    res.status(403).json({ message: "Admin access required." });
    return false;
  }

  return true;
}

// =====================================================
// SEARCH PAID ORDERS
// =====================================================
// =====================================================
// STUDENT PICKUP
// =====================================================


// =====================================================
// GUARD: ADMIN ONLY
// =====================================================

// =====================================================
// HELPERS
// =====================================================
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =====================================================
// SEARCH PAID ORDERS
// =====================================================
//
// Accepts any of:
//   - Full matric number:  2023/CSC/001
//   - Suffix of matric:    001  or  C001  or  CSC/001
//   - Full order reference: EUH-11223904-...
//
module.exports.searchOrders = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const q = String(req.query.q || "").trim();

    if (!q) {
      return res.status(400).json({
        message:
          "Enter a matric number, its last 4 digits, or an order reference.",
      });
    }

    const escaped = escapeRegex(q);

    // =================================================
    // MATCH USERS BY MATRIC
    // =================================================
    // Full matric contains a slash → match exactly.
    // Short input (suffix like "001" or "C001") →
    // match any matric that ends with those characters.
    //
    // Require at least 2 characters for suffix search
    // to avoid matching the entire student body.
    //
    const isFullMatric = /[/\\]/.test(q);

    if (!isFullMatric && q.length < 2) {
      return res.status(400).json({
        message:
          "Enter at least 2 characters, or the full matric number.",
      });
    }

    const matricPattern = isFullMatric
      ? `^${escaped}$`
      : `${escaped}$`;

    const matchedUsers = await User.find({
      matric: { $regex: matricPattern, $options: "i" },
    })
      .select("_id fullName matric email")
      .limit(50)
      .lean();

    const matchedUserIds = matchedUsers.map((u) => u._id);

    // =================================================
    // MATCH ORDERS
    // =================================================
    const orders = await PaymentOrder.find({
      paymentStatus: "paid",
      $or: [
        {
          reference: {
            $regex: `^${escaped}$`,
            $options: "i",
          },
        },
        { userId: { $in: matchedUserIds } },
      ],
    })
      .sort({ paystackPaidAt: -1, paidAt: -1, createdAt: -1 })
      .populate("items.componentId", "image sku name")
      .populate("userId", "fullName matric email")
      .lean();

    // =================================================
    // SHAPE
    // =================================================
    const shaped = orders.map((o) => {
      const user =
        o.userId && typeof o.userId === "object" ? o.userId : null;

      return {
        id: String(o._id),
        reference: o.reference,
        userId: String(user?._id || o.userId || ""),
        userName: user?.fullName || "Unknown",
        matric: user?.matric || "",
        email: user?.email || null,
        items: Array.isArray(o.items)
          ? o.items.map((it) => {
              const populated =
                it.componentId && typeof it.componentId === "object"
                  ? it.componentId
                  : null;

              return {
                componentId: String(
                  populated?._id ?? it.componentId ?? ""
                ),
                name: it.name || "",
                price: Number(it.price) || 0,
                quantity: Number(it.quantity) || 0,
                image: populated?.image || null,
                sku: populated?.sku || null,
              };
            })
          : [],
        total: Number(o.amount || 0) / 100,
        currency: o.currency || "NGN",
        channel: o.paystackChannel || null,
        paidAt: o.paystackPaidAt || o.paidAt || o.createdAt,
        createdAt: o.createdAt,
        status: o.pickupStatus || "Paid",
      };
    });

    return res.status(200).json({
      message: "Orders fetched",
      count: shaped.length,
      orders: shaped,
    });
  } catch (error) {
    console.error(
      "Pickup search error:",
      error.response?.data || error.message
    );
    return res.status(500).json({
      message: "Unable to search orders. Please try again.",
    });
  }
};

// =====================================================
// UPDATE PICKUP STATUS
// =====================================================
module.exports.updatePickupStatus = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order ID." });
    }

    const allowed = ["Paid", "Ready", "Collected"];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        message: `Status must be one of: ${allowed.join(", ")}`,
      });
    }

    const order = await PaymentOrder.findById(id);
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    order.pickupStatus = status;
    await order.save();

    return res.status(200).json({
      message: "Status updated",
      pickupStatus: order.pickupStatus,
    });
  } catch (error) {
    console.error(
      "Update pickup status error:",
      error.response?.data || error.message
    );
    return res.status(500).json({
      message: "Unable to update status.",
    });
  }
};

// =====================================================
// HELPERS
// =====================================================
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}