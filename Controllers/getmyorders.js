// =====================================================
// GET PAID ORDERS FOR THE LOGGED-IN USER
// =====================================================
const PaymentOrder = require("../Models/paymentOrder");

module.exports.getMyOrders = async (req, res) => {
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