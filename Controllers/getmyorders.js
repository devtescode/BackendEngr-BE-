// =====================================================
// GET PAID ORDERS FOR THE LOGGED-IN USER
// =====================================================
const PaymentOrder = require("../Models/paymentOrder");
const mongoose = require("mongoose");


module.exports.getMyOrders = async (req, res) => {
    console.log("🔵 getMyOrders called for user:", req.user?.id);
    try {
        const userId = req.user.id;

        const orders = await PaymentOrder.find({
            userId,
            paymentStatus: "paid",
        })
            .sort({ paidAt: -1, createdAt: -1 })
            .populate("items.componentId", "image sku name")
            .lean();

        const shaped = orders.map((o) => ({
            id: o._id,
            reference: o.reference,
            items: o.items.map((it) => ({
                componentId: it.componentId?._id || it.componentId,
                name: it.name,
                price: it.price,             // keep as stored
                quantity: it.quantity,
                image: it.componentId?.image || null,
                sku: it.componentId?.sku || null,
            })),
            total: o.amount / 100,         // kobo → naira
            currency: o.currency,
            status: "Paid",
            channel: o.paystackChannel || null,
            paidAt: o.paystackPaidAt || o.paidAt || o.createdAt,
            createdAt: o.createdAt,
        }));

        return res.status(200).json({
            message: "Orders fetched",
            orders: shaped,
        });
    } catch (error) {
        console.error(
            "Get orders error:",
            error.response?.data || error.message
        );
        return res.status(500).json({
            message: "Unable to load orders. Please try again.",
        });
    }
};






// =====================================================
// GET A SINGLE ORDER (RECEIPT) BY ID
// =====================================================
//
// Feeds the /orders/$id receipt page.
// Enforces ownership: a user can only fetch their
// own paid orders.
//
module.exports.getOrderById = async (req, res) => {
  console.log("🔵 getOrderById called:");
  console.log("   params.id:", req.params?.id);
  console.log("   user.id:", req.user?.id);

  try {
    const userId = req.user?.id;
    const rawId = req.params?.id;

    // =================================================
    // GUARD: AUTH
    // =================================================
    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized.",
      });
    }

    // =================================================
    // GUARD: ID PRESENCE
    // =================================================
    // Catches the "undefined" / "null" string case that
    // happens when the frontend builds the URL before
    // the order's id is populated.
    //
    if (!rawId || rawId === "undefined" || rawId === "null") {
      console.warn(
        `getOrderById: missing or invalid raw id "${rawId}"`
      );
      return res.status(400).json({
        message: "Invalid receipt ID.",
      });
    }

    // =================================================
    // GUARD: ID FORMAT
    // =================================================
    // Mongoose casts the string to ObjectId; without
    // this check, "abc" would throw a CastError and hit
    // the 500 handler.
    //
    if (!mongoose.Types.ObjectId.isValid(rawId)) {
      console.warn(
        `getOrderById: rejected malformed id "${rawId}"`
      );
      return res.status(400).json({
        message: "Invalid receipt ID.",
      });
    }

    // =================================================
    // FETCH
    // =================================================
    const order = await PaymentOrder.findOne({
      _id: rawId,
      userId,
      paymentStatus: "paid",
    })
      .populate("items.componentId", "image sku name")
      .lean();

    if (!order) {
      return res.status(404).json({
        message: "Receipt not found.",
      });
    }
    // =================================================
    // SHAPE RESPONSE
    // =================================================
    const amountKobo = Number(order.amount) || 0;
    const items = Array.isArray(order.items) ? order.items : [];

    const shaped = {
      // Coerce ObjectId → plain string so the frontend
      // never receives a Mongoose type.
      id: String(order._id),
      reference: order.reference || "",
      items: items.map((it) => {
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
      }),
      subtotal: amountKobo / 100,
      total: amountKobo / 100,
      currency: order.currency || "NGN",
      status: "Paid",
      channel: order.paystackChannel || null,
      paidAt:
        order.paystackPaidAt ||
        order.paidAt ||
        order.createdAt,
      createdAt: order.createdAt,
      paystackTransactionId:
        order.paystackTransactionId || null,
      paystackFees: order.paystackFees
        ? Number(order.paystackFees) / 100
        : 0,
      customerEmail:
        order.paystackCustomer?.email || null,
    };

    return res.status(200).json({
      message: "Receipt fetched",
      order: shaped,
    });
  } catch (error) {
    console.error(
      "Get order by ID error:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      message: "Unable to load receipt. Please try again.",
    });
  }
};