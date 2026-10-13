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
// module.exports.getOrderById = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { id } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({
//         message: "Invalid receipt ID.",
//       });
//     }

//     const order = await PaymentOrder.findOne({
//       _id: id,
//       userId,
//       paymentStatus: "paid",
//     })
//       .populate("items.componentId", "image sku name")
//       .lean();

//     if (!order) {
//       return res.status(404).json({
//         message: "Receipt not found.",
//       });
//     }

//     const shaped = {
//       id: order._id,
//       reference: order.reference,
//       items: order.items.map((it) => ({
//         componentId: it.componentId?._id || it.componentId,
//         name: it.name,
//         price: it.price,
//         quantity: it.quantity,
//         image: it.componentId?.image || null,
//         sku: it.componentId?.sku || null,
//       })),
//       subtotal: order.amount / 100,
//       total: order.amount / 100,
//       currency: order.currency,
//       status: "Paid",
//       channel: order.paystackChannel || null,
//       paidAt: order.paystackPaidAt || order.paidAt || order.createdAt,
//       createdAt: order.createdAt,
//       paystackTransactionId: order.paystackTransactionId || null,
//       paystackFees: order.paystackFees ? order.paystackFees / 100 : 0,
//       customerEmail: order.paystackCustomer?.email || null,
//     };

//     return res.status(200).json({
//       message: "Receipt fetched",
//       order: shaped,
//     });
//   } catch (error) {
//     console.error(
//       "Get order by ID error:",
//       error.response?.data || error.message
//     );
//     return res.status(500).json({
//       message: "Unable to load receipt. Please try again.",
//     });
//   }
// };