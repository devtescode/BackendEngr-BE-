const mongoose = require("mongoose");

const componentSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    category: {
      type: String,
      required: true,
      enum: [
        "Microcontroller",
        "Sensors",
        "Prototyping",
        "Passive",
        "Power",
        "Connector",
      ],
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    stock: {
      type: Number,
      required: true,
      min: 0,
    },
    // Models/component.js
    soldCount: { type: Number, default: 0, index: true },

    description: {
      type: String,
      default: "",
    },

    details: {
      type: String,
      default: "",
    },

    image: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Supports the public listing's default createdAt-desc order with
// the deterministic _id tie-breaker and its paginated range scans.
componentSchema.index({ createdAt: -1, _id: -1 });

// The components page sorts by updatedAt-desc with the same tie-breaker.
componentSchema.index({ updatedAt: -1, _id: -1 });

// The category chips filter the listing before it is sorted and paged, so
// the filter field leads the compound index for both sort orders.
componentSchema.index({ category: 1, createdAt: -1 });
componentSchema.index({ category: 1, updatedAt: -1 });

module.exports = mongoose.model("Component", componentSchema);