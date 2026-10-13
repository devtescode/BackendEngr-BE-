
const axios = require("axios");
const crypto = require("crypto");
const mongoose = require("mongoose");

const Cart = require("../Models/cart");
const Component = require("../Models/component");
const PaymentOrder = require("../Models/paymentOrder");

// Initialize Paystack payment
module.exports.initializePayment = async (req, res) => {
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(500).json({
        message: "Paystack is not configured on the server",
      });
    }

    // Your existing verifyToken middleware must set req.user.id.
    const userId = req.user.id;
    const email = req.user.email;

    if (!email) {
      return res.status(400).json({
        message:
          "Customer email is missing. Check your authentication payload.",
      });
    }

    const cart = await Cart.findOne({ userId }).populate(
      "items.componentId"
    );

    if (!cart || !cart.items.length) {
      return res.status(400).json({
        message: "Your cart is empty",
      });
    }

    let amountNaira = 0;
    const orderItems = [];

    for (const item of cart.items) {
      const component = item.componentId;

      if (!component || !mongoose.Types.ObjectId.isValid(component._id)) {
        return res.status(400).json({
          message: "A cart item is no longer available",
        });
      }

      const quantity = Number(item.quantity);
      const price = Number(component.price);

      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        !Number.isFinite(price) ||
        price < 0
      ) {
        return res.status(400).json({
          message: "Invalid cart item or price",
        });
      }

      if (component.stock < quantity) {
        return res.status(400).json({
          message: `${component.name} does not have enough stock`,
        });
      }

      amountNaira += price * quantity;

      orderItems.push({
        componentId: component._id,
        name: component.name,
        price,
        quantity,
      });
    }

    // Convert NGN to kobo. Reject amounts that cannot be
    // represented exactly in kobo.
    const amountKobo = Math.round(amountNaira * 100);

    if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
      return res.status(400).json({
        message: "Invalid payment amount",
      });
    }

    const reference = `EUH-${crypto.randomUUID()}`;

    // Save a pending order before sending the customer to Paystack.
    await PaymentOrder.create({
      userId,
      reference,
      items: orderItems,
      amount: amountKobo,
      currency: "NGN",
      paymentStatus: "pending",
    });

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amountKobo,
        currency: "NGN",
        reference,
        callback_url:
          `${process.env.FRONTEND_URL}/payment/callback`,
        metadata: {
          reference,
          userId: String(userId),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    if (!response.data.status) {
      throw new Error("Paystack initialization failed");
    }

    return res.status(200).json({
      message: "Payment initialized",
      authorizationUrl: response.data.data.authorization_url,
      reference: response.data.data.reference,
    });
  } catch (error) {
    console.error(
      "Paystack initialization error:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      message: "Unable to initialize payment. Please try again.",
    });
  }
};

// Verify a transaction after Paystack redirects back
module.exports.verifyPayment = async (req, res) => {
  try {
    const reference = String(req.query.reference || "");

    if (!reference || !/^[a-zA-Z0-9.= -]+$/.test(reference)) {
      return res.status(400).json({
        message: "A valid payment reference is required",
      });
    }

    const order = await PaymentOrder.findOne({
      reference,
      userId: req.user.id,
    });

    if (!order) {
      return res.status(404).json({
        message: "Payment order not found",
      });
    }

    // A verified payment is idempotent: don't process it twice.
    if (order.paymentStatus === "paid") {
      return res.status(200).json({
        message: "Payment already verified",
        status: "success",
        reference,
      });
    }

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
        timeout: 15000,
      }
    );

    const transaction = response.data.data;

    if (
      !response.data.status ||
      transaction.status !== "success" ||
      transaction.reference !== order.reference ||
      transaction.amount !== order.amount ||
      transaction.currency !== order.currency
    ) {
      return res.status(400).json({
        message: "Payment has not been verified successfully",
        status: transaction?.status || "pending",
      });
    }

    order.paymentStatus = "paid";
    order.paidAt = transaction.paid_at
      ? new Date(transaction.paid_at)
      : new Date();

    await order.save();

    return res.status(200).json({
      message: "Payment verified successfully",
      status: "success",
      reference,
    });
  } catch (error) {
    console.error(
      "Paystack verification error:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      message: "Unable to verify payment. Please try again.",
    });
  }
};

// =====================================================
// PAYSTACK WEBHOOK
// =====================================================
//
// Paystack sends POST events here for every transaction
// lifecycle event. This is the source of truth — do NOT
// rely solely on the frontend verify call, since users
// may close the browser before the callback page loads.
//
// IMPORTANT: This route must be registered BEFORE
// express.json() middleware, or with express.raw(),
// because the signature is computed over the RAW body.
//
module.exports.paystackWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;

    if (!secret) {
      console.error("Webhook: PAYSTACK_SECRET_KEY not set");
      return res.sendStatus(500);
    }

    // =================================================
    // VERIFY SIGNATURE
    // =================================================
    // Paystack signs the raw request body with HMAC-SHA512
    // using your secret key. If it doesn't match, ignore.
    //
    const hash = crypto
      .createHmac("sha512", secret)
      .update(req.body) // req.body must be a Buffer here
      .digest("hex");

    const signature = req.headers["x-paystack-signature"];

    if (hash !== signature) {
      console.warn("Webhook: invalid signature");
      return res.sendStatus(401);
    }

    // =================================================
    // ACKNOWLEDGE IMMEDIATELY
    // =================================================
    // Return 200 BEFORE processing. Paystack retries for
    // up to 72 hours if you don't respond quickly.
    //
    res.sendStatus(200);

    // =================================================
    // PROCESS EVENT ASYNCHRONOUSLY
    // =================================================
    const event = JSON.parse(req.body.toString());

    console.log("💳 PAYSTACK WEBHOOK EVENT:", event.event);

    // =================================================
    // HANDLE charge.success
    // =================================================
    if (event.event === "charge.success") {
      const { reference, amount, currency, paid_at } = event.data;

      if (!reference) {
        console.warn("Webhook: missing reference");
        return;
      }

      const order = await PaymentOrder.findOne({ reference });

      if (!order) {
        console.warn(
          `Webhook: no PaymentOrder found for reference ${reference}`
        );
        return;
      }

      // Idempotent — if already paid, do nothing.
      if (order.paymentStatus === "paid") {
        console.log(
          `Webhook: order ${reference} already marked paid`
        );
        return;
      }

      // Sanity checks against what we stored.
      if (
        amount !== order.amount ||
        currency !== order.currency
      ) {
        console.error(
          `Webhook: amount/currency mismatch for ${reference}`,
          {
            received: { amount, currency },
            stored: { amount: order.amount, currency: order.currency },
          }
        );
        return;
      }

      // =================================================
      // UPDATE ORDER STATUS
      // =================================================
      order.paymentStatus = "paid";
      order.paidAt = paid_at ? new Date(paid_at) : new Date();

      // =================================================
      // STORE EXTRA PAYSTACK DETAILS
      // =================================================
      order.paystackTransactionId = String(event.data.id || "");
      order.paystackChannel = event.data.channel || "";
      order.paystackGatewayResponse = event.data.gateway_response || "";
      order.paystackFees = event.data.fees;
      order.paystackPaidAt = paid_at ? new Date(paid_at) : null;

      if (event.data.authorization) {
        order.paystackAuthorization = {
          authorization_code:
            event.data.authorization.authorization_code,
          card_type: event.data.authorization.card_type,
          last4: event.data.authorization.last4,
          exp_month: event.data.authorization.exp_month,
          exp_year: event.data.authorization.exp_year,
          bin: event.data.authorization.bin,
          bank: event.data.authorization.bank,
        };
      }

      if (event.data.customer) {
        order.paystackCustomer = {
          email: event.data.customer.email,
          customer_code: event.data.customer.customer_code,
        };
      }

      // Optional: store the entire Paystack payload for audit.
      order.paystackRawData = event.data;

      await order.save();

      console.log(`✅ Webhook: order ${reference} marked paid`);
      console.log(`   Paystack ID: ${event.data.id}`);
      console.log(`   Channel: ${event.data.channel}`);
      console.log(
        `   Fee: ₦${((event.data.fees || 0) / 100).toLocaleString("en-NG")}`
      );

      // =================================================
      // CLEAR THE USER'S CART
      // =================================================
      await Cart.findOneAndUpdate(
        { userId: order.userId },
        { $set: { items: [] } }
      );

      // =================================================
      // REAL-TIME CART UPDATE VIA SOCKET
      // =================================================
      req.io
        ?.to(String(order.userId))
        .emit("cart:updated", { items: [] });

      return;
    }

    // =================================================
    // HANDLE charge.failed
    // =================================================
    if (event.event === "charge.failed") {
      const { reference } = event.data;
      if (!reference) return;

      await PaymentOrder.findOneAndUpdate(
        { reference },
        { $set: { paymentStatus: "failed" } }
      );

      console.log(`❌ Webhook: order ${reference} marked failed`);
      return;
    }

    // =================================================
    // OTHER EVENTS — log and ignore
    // =================================================
    console.log(`ℹ️ Webhook: unhandled event "${event.event}"`);
  } catch (error) {
    console.error(
      "Paystack webhook error:",
      error.response?.data || error.message
    );
    // We already sent 200, so nothing more to do.
  }
};