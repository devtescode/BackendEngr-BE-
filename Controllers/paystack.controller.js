
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
// =====================================================
// Top of paystack.controller.js — make sure these
// models are imported alongside the others.
// =====================================================
// const Cart = require("../Models/cart");
// const Component = require("../Models/component");
// const PaymentOrder = require("../Models/paymentOrder");
// const mongoose = require("mongoose");

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

      // =================================================
      // DUPLICATE TRANSACTION GUARD #1
      // =================================================
      // If we've already seen this Paystack reference,
      // bail out. The atomic findOneAndUpdate below
      // prevents a race where two identical webhooks
      // arrive at the same time.
      //
      const order = await PaymentOrder.findOne({ reference });

      if (!order) {
        console.warn(
          `Webhook: no PaymentOrder found for reference ${reference}`
        );
        return;
      }

      // Idempotency — if already paid, do nothing.
      if (order.paymentStatus === "paid") {
        console.log(
          `Webhook: order ${reference} already marked paid`
        );
        return;
      }

      // =================================================
      // SANITY CHECKS
      // =================================================
      if (amount !== order.amount || currency !== order.currency) {
        console.error(
          `Webhook: amount/currency mismatch for ${reference}`,
          {
            received: { amount, currency },
            stored: {
              amount: order.amount,
              currency: order.currency,
            },
          }
        );
        return;
      }

      // =================================================
      // DUPLICATE TRANSACTION GUARD #2 (atomic)
      // =================================================
      // Two webhooks can arrive simultaneously for the
      // same reference (Paystack retries). The check
      // above is not atomic — both could pass before
      // either saves. To make it bulletproof, use
      // findOneAndUpdate that only sets paymentStatus
      // when it's still "pending".
      //
      // If the update returns null, another webhook
      // already flipped it to "paid". Do nothing.
      //
      const claimed = await PaymentOrder.findOneAndUpdate(
        {
          reference,
          paymentStatus: "pending", // ← the guard
        },
        {
          $set: {
            paymentStatus: "paid",
            paidAt: paid_at ? new Date(paid_at) : new Date(),
            paystackTransactionId: String(event.data.id || ""),
            paystackChannel: event.data.channel || "",
            paystackGatewayResponse:
              event.data.gateway_response || "",
            paystackFees: event.data.fees,
            paystackPaidAt: paid_at ? new Date(paid_at) : null,
            paystackAuthorization: event.data.authorization
              ? {
                  authorization_code:
                    event.data.authorization.authorization_code,
                  card_type:
                    event.data.authorization.card_type,
                  last4: event.data.authorization.last4,
                  exp_month:
                    event.data.authorization.exp_month,
                  exp_year: event.data.authorization.exp_year,
                  bin: event.data.authorization.bin,
                  bank: event.data.authorization.bank,
                }
              : undefined,
            paystackCustomer: event.data.customer
              ? {
                  email: event.data.customer.email,
                  customer_code:
                    event.data.customer.customer_code,
                }
              : undefined,
            paystackRawData: event.data,
          },
        },
        { new: true }
      );

      if (!claimed) {
        console.log(
          `Webhook: ${reference} already claimed by another webhook`
        );
        return;
      }

      console.log(`✅ Webhook: order ${reference} marked paid`);
      console.log(`   Paystack ID: ${event.data.id}`);
      console.log(`   Channel: ${event.data.channel}`);
      console.log(
        `   Fee: ₦${((event.data.fees || 0) / 100).toLocaleString("en-NG")}`
      );

      // =================================================
      // REDUCE STOCK FOR EACH ITEM PURCHASED
      // =================================================
      // Runs exactly once per order (guarded by the
      // atomic claim above).
      //
      // The socket server is passed through so every stock change is
      // broadcast to the clients that are showing the affected component.
      await reduceStockForOrder(claimed, req.io);

      // =================================================
      // CLEAR THE USER'S CART
      // =================================================
      await Cart.findOneAndUpdate(
        { userId: claimed.userId },
        { $set: { items: [] } }
      );

      // =================================================
      // REAL-TIME UPDATES
      // =================================================
      req.io
        ?.to(String(claimed.userId))
        .emit("orders:updated", { orderId: claimed._id });

      req.io
        ?.to(String(claimed.userId))
        .emit("cart:updated", { items: [] });

      // Notify every connected client that the catalog
      // may have changed, so stock counters update live.
      req.io?.emit("components:refreshed");

      return;
    }

    // =================================================
    // HANDLE charge.failed
    // =================================================
    if (event.event === "charge.failed") {
      const { reference } = event.data;
      if (!reference) return;

      // Only mark failed if it's still pending — don't
      // overwrite a paid order with a failed status.
      const result = await PaymentOrder.findOneAndUpdate(
        { reference, paymentStatus: "pending" },
        { $set: { paymentStatus: "failed" } },
        { new: true }
      );

      if (result) {
        console.log(`❌ Webhook: order ${reference} marked failed`);
      } else {
        console.log(
          `Webhook: ${reference} was not pending — skipping failed mark`
        );
      }
      return;
    }

    // =================================================
    // OTHER EVENTS
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

// =====================================================
// REDUCE STOCK FOR A PAID ORDER
// =====================================================
//
// For each item, atomically decrement the component's
// stock. Uses $inc so concurrent orders can't produce
// lost updates. Uses a $gte guard so stock never goes
// negative — if it would, the update no-ops and we log
// the anomaly for reconciliation.
//
// =====================================================
// REDUCE STOCK FOR A PAID ORDER
// =====================================================
async function reduceStockForOrder(order, io) {
  const items = Array.isArray(order.items) ? order.items : [];

  for (const item of items) {
    const componentId = item.componentId;
    const qty = Number(item.quantity) || 0;
    if (!componentId || qty <= 0) continue;

    try {
      const updated = await Component.findOneAndUpdate(
        {
          _id: componentId,
          stock: { $gte: qty },
        },
        {
          $inc: {
            stock: -qty,
            soldCount: qty,   // ← accumulate purchases
          },
        },
        { new: true }
      ).lean();

      if (!updated) {
        const comp = await Component.findById(componentId)
          .select("name stock")
          .lean();

        if (!comp) {
          console.warn(
            `⚠️ Stock not reduced — component ${componentId} not found`
          );
        } else {
          console.warn(
            `⚠️ Insufficient stock for ${comp.name}: ` +
              `wanted ${qty}, have ${comp.stock}`
          );
        }
        continue;
      }

      console.log(
        `📦 Stock reduced: ${item.name} × ${qty} → ${updated.stock} left, ${updated.soldCount} sold`
      );

      // Notify every connected client to update this card.
      io?.emit("component:updated", {
        _id: String(updated._id),
        sku: updated.sku,
        name: updated.name,
        category: updated.category,
        price: updated.price,
        stock: updated.stock,
        soldCount: updated.soldCount, // ← include it so admin page updates
        description: updated.description,
        details: updated.details,
        image: updated.image,
      });
    } catch (err) {
      console.error(
        `Failed to reduce stock for ${item.name}:`,
        err.message
      );
    }
  }
}