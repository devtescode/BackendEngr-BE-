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
      .populate("userId", "fullName matric email profileImageUrl")
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
        userImage:
          typeof user?.profileImageUrl === "string" &&
          user.profileImageUrl.startsWith("https://")
            ? user.profileImageUrl
            : null,
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

    // Don't overwrite a collected order with an earlier
    // status — collected is terminal.
    if (order.pickupStatus === "Collected" && status !== "Collected") {
      return res.status(400).json({
        message: "This order is already collected and cannot be reverted.",
      });
    }

    order.pickupStatus = status;

    // =================================================
    // STAMP collectedAt
    // =================================================
    // Set the timestamp the first time the order is
    // marked collected. Don't overwrite an existing
    // value if the same status is applied again.
    //
    if (status === "Collected" && !order.collectedAt) {
      order.collectedAt = new Date();
    }

    await order.save();

    // =================================================
    // NOTIFY THE STUDENT IN REAL-TIME
    // =================================================
    // The student's /orders page listens for this and
    // silently refetches, so their card updates the
    // moment the admin marks it collected.
    //
    if (req.io) {
      req.io
        .to(String(order.userId))
        .emit("orders:updated", { orderId: order._id });

      console.log(
        `📡 Emitted orders:updated to user ${order.userId}`
      );
    }

    return res.status(200).json({
      message: "Status updated",
      pickupStatus: order.pickupStatus,
      collectedAt: order.collectedAt || null,
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



// =====================================================
// COLLECTED ORDERS: QUERY SANITIZERS
// =====================================================
// Mirrors the style of getPaginatedComponents in
// componentController.js. Invalid input falls back to
// the default instead of erroring.
//
const COLLECTED_DEFAULT_PAGE = 1;
const COLLECTED_DEFAULT_LIMIT = 4;
const COLLECTED_MIN_LIMIT = 1;
const COLLECTED_MAX_LIMIT = 50;
const COLLECTED_MAX_SEARCH_LENGTH = 100;
const COLLECTED_MAX_USER_MATCHES = 500;

const COLLECTED_SORTS = {
  recent: { collectedAt: -1, paystackPaidAt: -1, createdAt: -1, _id: -1 },
  oldest: { collectedAt: 1, paystackPaidAt: 1, createdAt: 1, _id: 1 },
  highest: { amount: -1, collectedAt: -1, _id: -1 },
};

function getCollectedScalar(value) {
  if (Array.isArray(value)) {
    return value[0];
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return undefined;
}

function parseCollectedInteger(value, fallback) {
  const raw = getCollectedScalar(value);

  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);

  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function sanitizeCollectedPage(value) {
  const page = parseCollectedInteger(value, COLLECTED_DEFAULT_PAGE);

  return page >= 1 ? page : COLLECTED_DEFAULT_PAGE;
}

function sanitizeCollectedLimit(value) {
  const limit = parseCollectedInteger(value, COLLECTED_DEFAULT_LIMIT);

  return Math.min(COLLECTED_MAX_LIMIT, Math.max(COLLECTED_MIN_LIMIT, limit));
}

function sanitizeCollectedSearch(value) {
  const raw = getCollectedScalar(value);

  if (typeof raw !== "string") {
    return "";
  }

  return raw.trim().slice(0, COLLECTED_MAX_SEARCH_LENGTH);
}

function sanitizeCollectedSort(value) {
  const raw = getCollectedScalar(value);
  const sort = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  return Object.prototype.hasOwnProperty.call(COLLECTED_SORTS, sort)
    ? sort
    : "recent";
}

function escapeCollectedRegExp(value) {
  // Treat user input as a literal; with the 100-char cap this
  // prevents regex injection / ReDoS-style patterns.
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeProfileImageUrl(value) {
  return typeof value === "string" && value.startsWith("https://")
    ? value
    : null;
}

async function buildCollectedFilter(search) {
  const filter = {
    paymentStatus: "paid",
    pickupStatus: "Collected",
  };

  if (!search) {
    return filter;
  }

  const expression = new RegExp(escapeCollectedRegExp(search), "i");

  const matchedUsers = await User.find({
    $or: [
      { fullName: expression },
      { matric: expression },
      { email: expression },
    ],
  })
    .select("_id")
    .limit(COLLECTED_MAX_USER_MATCHES)
    .lean();

  filter.$or = [
    { reference: expression },
    { "items.name": expression },
    { userId: { $in: matchedUsers.map((u) => u._id) } },
  ];

  return filter;
}

async function getCollectedStats(filter) {
  const [row] = await PaymentOrder.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        students: { $addToSet: "$userId" },
        items: {
          $sum: {
            $reduce: {
              input: { $ifNull: ["$items", []] },
              initialValue: 0,
              in: {
                $add: [
                  "$$value",
                  { $ifNull: ["$$this.quantity", 0] },
                ],
              },
            },
          },
        },
        amount: { $sum: { $ifNull: ["$amount", 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        orders: 1,
        students: { $size: "$students" },
        items: 1,
        amount: 1,
      },
    },
  ]);

  return {
    orders: Number(row?.orders) || 0,
    students: Number(row?.students) || 0,
    items: Number(row?.items) || 0,
    value: (Number(row?.amount) || 0) / 100,
  };
}

// =====================================================
// GET ALL COLLECTED ORDERS
// =====================================================
// GET /admin/pickup/collected?page&limit&q&sort
//
module.exports.getCollectedOrders = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const requestedPage = sanitizeCollectedPage(req.query.page);
    const limit = sanitizeCollectedLimit(req.query.limit);
    const search = sanitizeCollectedSearch(req.query.q);
    const sort = sanitizeCollectedSort(req.query.sort);

    // Build the filter once so the page, total and stats
    // all describe the same result set.
    const filter = await buildCollectedFilter(search);

    const [totalItems, stats] = await Promise.all([
      PaymentOrder.countDocuments(filter),
      getCollectedStats(filter),
    ]);

    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);
    const page = totalItems === 0 ? 1 : Math.min(requestedPage, totalPages);
    const skip = (page - 1) * limit;

    const orders =
      totalItems === 0
        ? []
        : await PaymentOrder.find(filter)
            .sort(COLLECTED_SORTS[sort])
            .skip(skip)
            .limit(limit)
            .populate("items.componentId", "image sku name")
            .populate("userId", "fullName matric email profileImageUrl")
            .lean();

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
        userImage: safeProfileImageUrl(user?.profileImageUrl),
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
        collectedAt: o.collectedAt || null,
        status: "Collected",
      };
    });

    return res.status(200).json({
      message: "Collected orders fetched",
      orders: shaped,
      count: shaped.length,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
      },
      stats,
    });
  } catch (error) {
    console.error(
      "Get collected orders error:",
      error.response?.data || error.message
    );
    return res.status(500).json({
      message: "Unable to load collected orders.",
    });
  }
};