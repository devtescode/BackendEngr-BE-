const mongoose = require("mongoose");

const paymentOrderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    items: [
      {
        componentId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Component",
        },
        name: String,
        price: Number,
        quantity: Number,
      },
    ],
    amount: { type: Number, required: true }, // kobo
    currency: { type: String, default: "NGN" },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "cancelled"],
      default: "pending",
      index: true,
    },

    // =================================================
    // NEW FIELDS FROM PAYSTACK WEBHOOK
    // =================================================
    paystackTransactionId: { type: String },   // event.data.id
    paystackChannel: { type: String },         // card, bank, ussd, etc.
    paystackGatewayResponse: { type: String }, // "Successful"
    paystackAuthorization: {
      authorization_code: String,
      card_type: String,
      last4: String,
      exp_month: String,
      exp_year: String,
      bin: String,
      bank: String,
    },
    paystackCustomer: {
      email: String,
      customer_code: String,
    },
    paystackFees: { type: Number },            // Paystack fee in kobo
    paystackPaidAt: { type: Date },            // Paystack's paid_at
    paystackRawData: { type: mongoose.Schema.Types.Mixed }, // full payload (optional)

    paidAt: { type: Date }, // your app's notion of when it was paid
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaymentOrder", paymentOrderSchema);