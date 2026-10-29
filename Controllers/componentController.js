const Component = require("../Models/component");
const uploadImage = require("../utils/uploadImage");
const Cart = require("../Models/cart");
const mongoose = require("mongoose");


// ======================================================
// PAGINATED COMPONENTS (PUBLIC) HELPERS
// ======================================================

const COMPONENT_CARD_FIELDS = [
  "_id",
  "sku",
  "name",
  "category",
  "price",
  "soldCount",
  "stock",
  "description",
  "details",
  "image",
  "createdAt",
  "updatedAt",
];

const COMPONENT_CARD_PROJECTION = COMPONENT_CARD_FIELDS.reduce(
  (projection, field) => {
    projection[field] = 1;
    return projection;
  },
  {}
);

const ALLOWED_COMPONENT_SORTS = new Set([
  "createdAt",
  "updatedAt",
  "price",
  "stock",
  "soldCount",
  "name",
  "sku",
]);

// Keep the category filter aligned with the schema enum rather
// than duplicating the list in the controller.
const componentCategoryPath = Component.schema?.path?.("category");
const ALLOWED_COMPONENT_CATEGORIES = new Set(
  Array.isArray(componentCategoryPath?.enumValues)
    ? componentCategoryPath.enumValues.filter(
        (value) => typeof value === "string"
      )
    : []
);

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 6;
const MIN_LIMIT = 1;
const MAX_LIMIT = 48;
const MAX_SEARCH_LENGTH = 100;
const UPDATED_AT_SORT_FIELD = "__sortUpdatedAt";

function getScalarQueryValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return undefined;
}

function parseIntegerParam(value, fallback) {
  const raw = getScalarQueryValue(value);

  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);

  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function sanitizePage(value) {
  const page = parseIntegerParam(value, DEFAULT_PAGE);

  return page >= 1 ? page : DEFAULT_PAGE;
}

function sanitizeLimit(value) {
  const limit = parseIntegerParam(value, DEFAULT_LIMIT);

  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, limit));
}

function sanitizeSort(value) {
  const raw = getScalarQueryValue(value);
  const sort = typeof raw === "string" ? raw.trim() : "";

  return ALLOWED_COMPONENT_SORTS.has(sort) ? sort : "createdAt";
}

function sanitizeOrder(value) {
  const raw = getScalarQueryValue(value);
  const order = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  return order === "asc" || order === "desc" ? order : "desc";
}

function sanitizeSearch(value) {
  const raw = getScalarQueryValue(value);

  if (typeof raw !== "string") {
    return "";
  }

  return raw.trim().slice(0, MAX_SEARCH_LENGTH);
}

function sanitizeCategory(value) {
  const raw = getScalarQueryValue(value);
  const category = typeof raw === "string" ? raw.trim() : "";

  return ALLOWED_COMPONENT_CATEGORIES.has(category) ? category : "";
}

function escapeRegExp(value) {
  // Escape every regex metacharacter so user input is treated as
  // a literal. Combined with the 100-character cap, this prevents
  // regex injection and ReDoS-style patterns.
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildComponentFilter(search, category) {
  const filter = {};

  if (category) {
    filter.category = category;
  }

  if (search) {
    const searchExpression = new RegExp(escapeRegExp(search), "i");

    filter.$or = [
      { name: searchExpression },
      { sku: searchExpression },
      { description: searchExpression },
    ];
  }

  return filter;
}


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
// GET PAGINATED COMPONENTS
// GET /engineering/components
// ======================================================

module.exports.getPaginatedComponents = async (req, res) => {
  try {
    const requestedPage = sanitizePage(req.query.page);
    const limit = sanitizeLimit(req.query.limit);
    const sort = sanitizeSort(req.query.sort);
    const order = sanitizeOrder(req.query.order);
    const search = sanitizeSearch(req.query.search);
    const category = sanitizeCategory(req.query.category);

    // Build the complete filter before counting so the total and
    // the page always describe the same result set.
    const filter = buildComponentFilter(search, category);

    const totalItems = await Component.countDocuments(filter);
    const totalPages =
      totalItems === 0 ? 0 : Math.ceil(totalItems / limit);
    const currentPage =
      totalItems === 0
        ? 1
        : Math.min(requestedPage, totalPages);
    const skip = (currentPage - 1) * limit;
    const direction = order === "asc" ? 1 : -1;

    let components;

    if (sort === "updatedAt") {
      // Legacy records may not have updatedAt. Sort on a computed
      // fallback so those records still participate predictably.
      components = await Component.aggregate([
        { $match: filter },
        {
          $addFields: {
            [UPDATED_AT_SORT_FIELD]: {
              $ifNull: ["$updatedAt", "$createdAt"],
            },
          },
        },
        {
          $sort: {
            [UPDATED_AT_SORT_FIELD]: direction,
            _id: direction,
          },
        },
        { $skip: skip },
        { $limit: limit },
        { $project: COMPONENT_CARD_PROJECTION },
      ]);
    } else {
      components = await Component.find(filter)
        .select(COMPONENT_CARD_FIELDS.join(" "))
        .sort({
          [sort]: direction,
          _id: direction,
        })
        .skip(skip)
        .limit(limit)
        .lean();
    }

    return res.status(200).json({
      success: true,
      data: components,
      pagination: {
        currentPage,
        pageSize: limit,
        totalItems,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPreviousPage: currentPage > 1,
      },
    });
  } catch (error) {
    console.error("Get paginated components error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch components",
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

// Controllers/componentController.js


// =====================================================
// DELETE COMPONENT
// =====================================================
module.exports.deleteComponent = async (req, res) => {
  try {
    const { id } = req.params;

    // --------------------------------------------
    // GUARD: MISSING / MALFORMED ID
    // --------------------------------------------
    // Catches:
    //   - undefined / null / empty
    //   - literal strings "undefined" and "null"
    //     (these happen when a broken frontend link
    //      passes an undefined variable into the URL)
    //   - non-ObjectId strings like "abc"
    //
    if (
      !id ||
      id === "undefined" ||
      id === "null" ||
      !mongoose.Types.ObjectId.isValid(id)
    ) {
      console.warn(
        `deleteComponent: rejected invalid id "${id}"`
      );
      return res.status(400).json({
        message: "Invalid component ID.",
      });
    }

    // --------------------------------------------
    // FIND + DELETE (single atomic operation)
    // --------------------------------------------
    // `findByIdAndDelete` returns the document
    // that was deleted, or null if nothing matched.
    // No need for a separate find + delete.
    //
    const component = await Component.findByIdAndDelete(id);

    if (!component) {
      return res.status(404).json({
        message: "Component not found.",
      });
    }

    console.log("🗑️ Component deleted:", component._id);

    // --------------------------------------------
    // WEBSOCKET BROADCAST
    // --------------------------------------------
    // Emit only the ID — the frontend removes the
    // matching row. Emitting the full object would
    // be wasteful since it's already gone.
    //
    if (req.io) {
      req.io.emit("component:deleted", {
        _id: component._id.toString(),
      });

      console.log("📡 WebSocket: component:deleted emitted");
    }

    return res.status(200).json({
      message: "Component deleted successfully",
      component,
    });
  } catch (error) {
    console.error(
      "Delete component error:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      message: "Failed to delete component.",
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
        "fullName email matric profileImageUrl"
      )
      .populate(
        "items.componentId",
        "name sku price image category"
      )
      .sort({ updatedAt: -1 });

    // Skip carts of deleted users and items of deleted components;
    // a cart left with no items is dropped too.
    const visibleCarts = carts
      .filter((cart) => cart.userId)
      .map((cart) => {
        const json = cart.toJSON();
        json.items = (json.items || []).filter(
          (item) => item.componentId
        );
        return json;
      })
      .filter((cart) => cart.items.length > 0);

    return res.status(200).json({
      carts: visibleCarts,
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
