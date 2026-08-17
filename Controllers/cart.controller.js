const mongoose = require("mongoose");
const Cart = require("../Models/cart");
const Component = require("../Models/component");

// ======================================================
// ADD TO CART / INCREASE QUANTITY
// POST /engineering/addtocart
// ======================================================

module.exports.addToCart = async (req, res) => {
  try {
    const { componentId, quantity = 1 } = req.body;

    const userId = req.user.id;

    // Validate component ID
    if (!componentId) {
      return res.status(400).json({
        message: "Component ID is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(componentId)) {
      return res.status(400).json({
        message: "Invalid component ID",
      });
    }

    // Validate quantity
    const qty = Number(quantity);

    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({
        message: "Quantity must be at least 1",
      });
    }

    // Find component
    const component = await Component.findById(
      componentId
    );

    if (!component) {
      return res.status(404).json({
        message: "Component not found",
      });
    }

    // Check stock
    if (component.stock <= 0) {
      return res.status(400).json({
        message: "Component is out of stock",
      });
    }

    // Find user's cart
    let cart = await Cart.findOne({
      userId,
    });

    // Create cart if user doesn't have one
    if (!cart) {
      cart = new Cart({
        userId,
        items: [],
      });
    }

    // Find existing item
    const existingItem = cart.items.find(
      (item) =>
        item.componentId.toString() ===
        componentId.toString()
    );

    // ======================================================
    // EXISTING ITEM
    // ======================================================

    if (existingItem) {
      const newQuantity =
        existingItem.quantity + qty;

      // Check TOTAL quantity against stock
      if (newQuantity > component.stock) {
        return res.status(400).json({
          message: `Only ${component.stock} units available`,
        });
      }

      existingItem.quantity = newQuantity;
    }

    // ======================================================
    // NEW ITEM
    // ======================================================

    else {
      if (qty > component.stock) {
        return res.status(400).json({
          message: `Only ${component.stock} units available`,
        });
      }

      cart.items.push({
        componentId,
        quantity: qty,
      });
    }

    // Save cart
    await cart.save();

    // Populate component information
    const populatedCart =
      await Cart.findById(cart._id).populate(
        "items.componentId"
      );

    // ======================================================
    // SOCKET.IO REAL-TIME UPDATE
    // ======================================================

    const io = req.app.get("io");

    if (io) {
      io.to(`user:${userId}`).emit(
        "cart:updated",
        populatedCart
      );
    }

    return res.status(200).json({
      message: "Cart updated successfully",
      cart: populatedCart,
    });

  } catch (error) {
    console.error(
      "Add to cart error:",
      error
    );

    return res.status(500).json({
      message: "Failed to add item to cart",
      error: error.message,
    });
  }
};


// ======================================================
// UPDATE CART QUANTITY
// PUT /engineering/cart/:componentId
// ======================================================

module.exports.updateCartQuantity = async (
  req,
  res
) => {
  try {
    const { componentId } = req.params;
    const { quantity } = req.body;

    const userId = req.user.id;

    // Validate ID
    if (!mongoose.Types.ObjectId.isValid(componentId)) {
      return res.status(400).json({
        message: "Invalid component ID",
      });
    }

    // Validate quantity
    const newQuantity = Number(quantity);

    if (
      !Number.isInteger(newQuantity) ||
      newQuantity < 1
    ) {
      return res.status(400).json({
        message: "Quantity must be at least 1",
      });
    }

    // Find component
    const component = await Component.findById(
      componentId
    );

    if (!component) {
      return res.status(404).json({
        message: "Component not found",
      });
    }

    // Check stock
    if (newQuantity > component.stock) {
      return res.status(400).json({
        message: `Only ${component.stock} units available`,
      });
    }

    // Find cart
    const cart = await Cart.findOne({
      userId,
    });

    if (!cart) {
      return res.status(404).json({
        message: "Cart not found",
      });
    }

    // Find item
    const item = cart.items.find(
      (item) =>
        item.componentId.toString() ===
        componentId.toString()
    );

    if (!item) {
      return res.status(404).json({
        message: "Item not found in cart",
      });
    }

    // Update quantity
    item.quantity = newQuantity;

    await cart.save();

    // Populate cart
    const populatedCart =
      await Cart.findById(cart._id).populate(
        "items.componentId"
      );

    // REAL-TIME UPDATE
    const io = req.app.get("io");

    if (io) {
      io.to(`user:${userId}`).emit(
        "cart:updated",
        populatedCart
      );
    }

    return res.status(200).json({
      message: "Cart quantity updated",
      cart: populatedCart,
    });

  } catch (error) {
    console.error(
      "Update cart quantity error:",
      error
    );

    return res.status(500).json({
      message: "Failed to update cart quantity",
      error: error.message,
    });
  }
};


// ======================================================
// REMOVE ITEM FROM CART
// DELETE /engineering/cart/:componentId
// ======================================================

module.exports.removeFromCart = async (
  req,
  res
) => {
  try {
    const { componentId } = req.params;

    const userId = req.user.id;

    // Validate ID
    if (!mongoose.Types.ObjectId.isValid(componentId)) {
      return res.status(400).json({
        message: "Invalid component ID",
      });
    }

    // Find cart
    const cart = await Cart.findOne({
      userId,
    });

    if (!cart) {
      return res.status(404).json({
        message: "Cart not found",
      });
    }

    // Check item exists
    const itemExists = cart.items.some(
      (item) =>
        item.componentId.toString() ===
        componentId.toString()
    );

    if (!itemExists) {
      return res.status(404).json({
        message: "Item not found in cart",
      });
    }

    // Remove item
    cart.items = cart.items.filter(
      (item) =>
        item.componentId.toString() !==
        componentId.toString()
    );

    await cart.save();

    // Populate cart
    const populatedCart =
      await Cart.findById(cart._id).populate(
        "items.componentId"
      );

    // REAL-TIME UPDATE
    const io = req.app.get("io");

    if (io) {
      io.to(`user:${userId}`).emit(
        "cart:updated",
        populatedCart
      );
    }

    return res.status(200).json({
      message: "Item removed from cart",
      cart: populatedCart,
    });

  } catch (error) {
    console.error(
      "Remove from cart error:",
      error
    );

    return res.status(500).json({
      message: "Failed to remove item from cart",
      error: error.message,
    });
  }
};


module.exports.getCart = async (req, res) => {
  try {
    const userId = req.user.id;

    const cart = await Cart.findOne({ userId })
      .populate("items.componentId");

    if (!cart) {
      return res.status(200).json({
        items: [],
      });
    }

    return res.status(200).json(cart);

  } catch (error) {
    console.error("Get cart error:", error);

    return res.status(500).json({
      message: "Failed to get cart",
      error: error.message,
    });
  }
};