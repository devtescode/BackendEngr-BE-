const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
require("dotenv").config();
const cors = require("cors");
const { Server } = require("socket.io");

const userRoutes = require("./Routes/user.routes");
const adminRoutes = require("./Routes/user.adminRoutes");
const paystackRoutes = require("./Routes/paystack.routes");
const { paystackWebhook } = require("./Controllers/paystack.controller");

const app = express();
const server = http.createServer(app);

// Behind Render's proxy: lets rate limiting see the real client IP.
app.set("trust proxy", 1);

// ======================================================
// SOCKET.IO
// ======================================================

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

// Make io available inside controllers through req.io
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ======================================================
// CONFIG
// ======================================================

const PORT = process.env.PORT || 4500;
const URI = process.env.URI;

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

// ======================================================
// ⚠️ PAYSTACK WEBHOOK — MUST BE REGISTERED BEFORE
// express.json() / express.urlencoded()
// ======================================================
//
// Paystack signs the RAW request body. If express.json()
// runs first, it consumes the stream and converts the
// body into an object, breaking HMAC verification.
//
app.post(
  "/api/paystack/webhook",
  express.raw({ type: "application/json" }),
  paystackWebhook
);

// ======================================================
// NORMAL BODY PARSERS (for all other routes)
// ======================================================

app.use(express.urlencoded({ extended: true, limit: "200mb" }));
app.use(express.json({ limit: "200mb" }));

// ======================================================
// DATABASE
// ======================================================

mongoose
  .connect(URI)
  .then(() => {
    console.log("Database connected successfully Engineering Backend");
  })
  .catch((err) => {
    console.error("Database connection error:", err);
  });

// ======================================================
// ROUTES
// ======================================================

app.use("/admin", adminRoutes);
app.use("/engineering", userRoutes);
app.use("/api/paystack", paystackRoutes);

// ======================================================
// SOCKET CONNECTION
// ======================================================

io.on("connection", (socket) => {
  console.log("🟢 Client connected:", socket.id);

  socket.on("user:join", ({ userId }) => {
    if (!userId) {
      console.log("❌ No userId supplied");
      return;
    }

    // If the socket is already in this room, don't log
    // again — just silently accept the (idempotent) join.
    if (socket.rooms.has(userId)) {
      return;
    }

    socket.join(userId);
    console.log(`👤 User ${userId} joined socket room`);
  });

  socket.on("disconnect", (reason) => {
    console.log("🔴 Client disconnected:", socket.id, reason);
  });
});

// ======================================================
// ROOT
// ======================================================

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Welcome to Engineering Backend",
  });
});

// ======================================================
// ERROR HANDLER
// ======================================================

app.use((err, req, res, next) => {
  console.error("Error:", err.message);
  res.status(500).json({
    message: "Internal Server Error",
  });
});

// ======================================================
// START SERVER
// ======================================================

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});