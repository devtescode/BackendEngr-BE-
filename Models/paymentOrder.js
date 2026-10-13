
const mongoose = require("mongoose");

const paymentOrderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    reference: {
      type: String,
      required: true,
      unique: true,
    },

    items: [
      {
        componentId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Component",
          required: true,
        },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, required: true },
      },
    ],

    amount: {
      type: Number,
      required: true,
    },

    currency: {
      type: String,
      default: "NGN",
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },

    paidAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "PaymentOrder",
  paymentOrderSchema
);
