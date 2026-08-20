const Component = require("../Models/component");
const uploadImage = require("../utils/uploadImage");
const Cart = require("../Models/cart");


// ======================================================
// GET ALL COMPONENTS
// GET /admin/components
// ======================================================

module.exports.getComponents = async (req, res) => {
  try {
    const components = await Component.find().sort({
      createdAt: -1,
    });

    console.log(
      "Components fetched successfully:",
      components.length
    );

    return res.status(200).json(components);
  } catch (error) {
    console.error("Get components error:", error);

    return res.status(500).json({
      message: "Failed to fetch components",
      error: error.message,
    });
  }
};

// ======================================================
// GET ONE COMPONENT
// GET /admin/components/:id
// ======================================================

module.exports.getComponent = async (req, res) => {
  try {
    const { id } = req.params;

    const component = await Component.findById(id);

    if (!component) {
      return res.status(404).json({
        message: "Component not found",
      });
    }

    return res.status(200).json(component);
  } catch (error) {
    console.error("Get component error:", error);

    return res.status(500).json({
      message: "Failed to fetch component",
      error: error.message,
    });
  }
};

// ======================================================
// CREATE COMPONENT
// POST /admin/components
// ======================================================

module.exports.createComponent = async (req, res) => {
  try {
    const {
      sku,
      name,
      category,
      price,
      stock,
      description,
      details,
    } = req.body;

    // --------------------------------------------
    // VALIDATION
    // --------------------------------------------

    if (
      !sku ||
      !name ||
      !category ||
      price === undefined ||
      stock === undefined ||
      !description
    ) {
      return res.status(400).json({
        message: "Please provide all required fields",
      });
    }

    // --------------------------------------------
    // CHECK DUPLICATE SKU
    // --------------------------------------------

    const existing = await Component.findOne({ sku });

    if (existing) {
      return res.status(409).json({
        message: "A component with this SKU already exists",
      });
    }

    // --------------------------------------------
    // IMAGE
    // --------------------------------------------

    let image = "";
    let imagePublicId = "";

    if (req.file) {
      const result = await uploadImage(req.file.buffer);

      image = result.secure_url;
      imagePublicId = result.public_id;
    }

    // --------------------------------------------
    // CREATE COMPONENT
    // --------------------------------------------

    const component = await Component.create({
      sku,
      name,
      category,
      price: Number(price),
      stock: Number(stock),
      description,
      details: details || "",
      image,
      imagePublicId,
    });

    console.log(
      "Component created:",
      component._id
    );

    // ==================================================
    // WEBSOCKET EVENT
    // ==================================================

    if (req.io) {
      req.io.emit(
        "component:created",
        component
      );

      console.log(
        "WebSocket: component:created emitted"
      );
    }

    return res.status(201).json(component);
  } catch (error) {
    console.error(
      "Create component error:",
      error
    );

    return res.status(500).json({
      message: "Failed to create component",
      error: error.message,
    });
  }
};

// ======================================================
// UPDATE COMPONENT
// PUT /admin/components/:id
// ======================================================

module.exports.updateComponent = async (req, res) => {
  try {
    const { id } = req.params;

    // --------------------------------------------
    // FIND COMPONENT
    // --------------------------------------------

    const component =
      await Component.findById(id);

    if (!component) {
      return res.status(404).json({
        message: "Component not found",
      });
    }

    const {
      sku,
      name,
      category,
      price,
      stock,
      description,
      details,
    } = req.body;

    // --------------------------------------------
    // CHECK SKU
    // --------------------------------------------

    if (sku && sku !== component.sku) {
      const existing =
        await Component.findOne({
          sku,
          _id: { $ne: id },
        });

      if (existing) {
        return res.status(409).json({
          message:
            "A component with this SKU already exists",
        });
      }

      component.sku = sku;
    }

    // --------------------------------------------
    // UPDATE FIELDS
    // --------------------------------------------

    if (name !== undefined) {
      component.name = name;
    }

    if (category !== undefined) {
      component.category = category;
    }

    if (price !== undefined) {
      component.price = Number(price);
    }

    if (stock !== undefined) {
      component.stock = Number(stock);
    }

    if (description !== undefined) {
      component.description = description;
    }

    if (details !== undefined) {
      component.details = details;
    }

    // --------------------------------------------
    // UPDATE IMAGE
    // --------------------------------------------

    if (req.file) {
      const result =
        await uploadImage(req.file.buffer);

      component.image = result.secure_url;
      component.imagePublicId =
        result.public_id;
    }

    // --------------------------------------------
    // SAVE
    // --------------------------------------------

    await component.save();

    console.log(
      "Component updated:",
      component._id
    );

    // ==================================================
    // WEBSOCKET EVENT
    // ==================================================

    if (req.io) {
      req.io.emit(
        "component:updated",
        component
      );

      console.log(
        "WebSocket: component:updated emitted"
      );
    }

    return res.status(200).json(component);
  } catch (error) {
    console.error(
      "Update component error:",
      error
    );

    return res.status(500).json({
      message: "Failed to update component",
      error: error.message,
    });
  }
};

// ======================================================
// DELETE COMPONENT
// DELETE /admin/components/:id
// ======================================================

module.exports.deleteComponent = async (req, res) => {
  try {
    const { id } = req.params;

    // --------------------------------------------
    // FIND COMPONENT
    // --------------------------------------------

    const component =
      await Component.findById(id);

    if (!component) {
      return res.status(404).json({
        message: "Component not found",
      });
    }

    // --------------------------------------------
    // DELETE
    // --------------------------------------------

    await Component.findByIdAndDelete(id);

    console.log(
      "Component deleted:",
      component._id
    );

    // ==================================================
    // WEBSOCKET EVENT
    // ==================================================

    if (req.io) {
      req.io.emit(
        "component:deleted",
        {
          _id: component._id.toString(),
        }
      );

      console.log(
        "WebSocket: component:deleted emitted"
      );
    }

    return res.status(200).json({
      message: "Component deleted successfully",
      component,
    });
  } catch (error) {
    console.error(
      "Delete component error:",
      error
    );

    return res.status(500).json({
      message: "Failed to delete component",
      error: error.message,
    });
  }
};

module.exports.getAllCarts = async (req, res) => {
  try {
    const carts = await Cart.find({
      "items.0": { $exists: true },
    })
      .populate(
        "userId",
        "fullName email matric"
      )
      .populate(
        "items.componentId",
        "name sku price image category"
      )
      .sort({ updatedAt: -1 });

    return res.status(200).json({
      carts,
    });
  } catch (error) {
    console.error(
      "Get all carts error:",
      error
    );

    return res.status(500).json({
      message: "Failed to get user carts",
      error: error.message,
    });
  }
};
