const PaymentOrder = require("../Models/paymentOrder");
const Cart = require("../Models/cart");
// Controllers/paystack.controller.js
module.exports.getuserOrdersdb = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const orders = await PaymentOrder.find({
      userId,
      paymentStatus: "paid",
    })
      .sort({ paystackPaidAt: -1, paidAt: -1, createdAt: -1 })
      .populate("items.componentId", "image sku name")
      .lean();

    const shaped = orders.map((o) => {
      const pickupStatus = o.pickupStatus || "Paid";

      return {
        id: String(o._id),
        reference: o.reference,
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
        status: pickupStatus,
        channel: o.paystackChannel || null,
        paidAt: o.paystackPaidAt || o.paidAt || o.createdAt,
        createdAt: o.createdAt,
        collectedAt: o.collectedAt || null,
      };
    });

    return res.status(200).json({
      message: "Orders fetched",
      count: shaped.length,
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
// Controllers/cart.controller.js
module.exports.getCartuserdb = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const cart = await Cart.findOne({ userId })
      .populate("items.componentId", "image sku name price stock")
      .lean();

    if (!cart) {
      return res.status(200).json({
        items: [],
      });
    }

    return res.status(200).json({
      _id: String(cart._id),
      userId: String(cart.userId),
      items: Array.isArray(cart.items) ? cart.items : [],
    });
  } catch (error) {
    console.error("Get cart error:", error.message);
    return res.status(500).json({
      message: "Unable to load cart.",
    });
  }
};