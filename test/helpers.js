// Shared test harness: in-memory MongoDB, a fresh Express app with only the
// user routes mounted, and a stubbed email module that records messages.
// Never requires index.js (that starts a server and connects to Atlas).

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.FRONTEND_URL = "http://localhost:5173";

const path = require("path");
const crypto = require("crypto");
const Module = require("module");

// ---------------------------------------------------------------------------
// Email stub — must be installed in require.cache BEFORE the routes/controllers
// are required, so the controller's destructured imports are the stub's.
// ---------------------------------------------------------------------------
const emailStub = {
  sent: [],
  // "ok" | "fail" | "unconfigured"
  mode: "ok",
  reset() {
    this.sent.length = 0;
    this.mode = "ok";
  },
};

function isEmailConfigured() {
  return emailStub.mode !== "unconfigured";
}

async function sendEmail(message) {
  if (emailStub.mode === "fail") {
    const err = new Error("stubbed email failure");
    err.status = 500;
    err.code = "STUB_FAIL";
    throw err;
  }
  if (emailStub.mode === "unconfigured") {
    const err = new Error("stubbed email not configured");
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  emailStub.sent.push(message);
  return { id: `stub-${emailStub.sent.length}` };
}

const emailPath = require.resolve(path.join(__dirname, "..", "utils", "email.js"));
const stubModule = new Module(emailPath, module);
stubModule.filename = emailPath;
stubModule.loaded = true;
stubModule.exports = { sendEmail, isEmailConfigured };
require.cache[emailPath] = stubModule;

// ---------------------------------------------------------------------------
// App + DB
// ---------------------------------------------------------------------------
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");

const userRoutes = require("../Routes/user.routes");
const User = require("../Models/user.models");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/engineering", userRoutes);
  return app;
}

let mongod;

async function startDb() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: "engr-test" });
  await User.init(); // build unique indexes
}

async function stopDb() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function clearDb() {
  await User.deleteMany({});
  emailStub.reset();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
let seq = 0;
function uniq() {
  seq += 1;
  return `${process.pid}${Date.now() % 100000}${seq}`;
}

function signupBody(overrides = {}) {
  const n = uniq();
  return {
    fullName: "Test User",
    email: `user${n}@example.com`,
    matric: `MAT${n}`,
    phoneNumber: `080${n}`,
    gender: "Male",
    password: "Password123!",
    ...overrides,
  };
}

// Create a user directly in the DB (bypasses signup + its rate limiter).
async function createUser({ verified = true, ...overrides } = {}) {
  const body = signupBody(overrides);
  const doc = { ...body };
  if (verified !== undefined) doc.isEmailVerified = verified;
  if (verified === true) doc.emailVerifiedAt = new Date();
  const user = await User.create(doc);
  return { user, password: body.password, body };
}

// Legacy user: inserted raw so isEmailVerified is entirely absent.
async function createLegacyUser(overrides = {}) {
  const bcrypt = require("bcryptjs");
  const body = signupBody(overrides);
  const hashed = await bcrypt.hash(body.password, 10);
  const res = await User.collection.insertOne({
    ...body,
    password: hashed,
    role: "student",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { id: res.insertedId, password: body.password, body };
}

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("hex");

function extractToken(message, kind /* "verify-email" | "reset-password" */) {
  const haystack = `${message?.text || ""}\n${message?.html || ""}`;
  const re = new RegExp(`http://localhost:5173/${kind}/([a-f0-9]{64})(?![a-f0-9])`);
  const m = haystack.match(re);
  return m ? m[1] : null;
}

function lastEmail() {
  return emailStub.sent[emailStub.sent.length - 1];
}

async function getUserRaw(filter) {
  return User.collection.findOne(filter);
}

function signJwtFor(user) {
  return jwt.sign(
    { id: String(user._id), email: user.email, role: user.role || "student", pwdv: 0 },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

module.exports = {
  emailStub,
  buildApp,
  startDb,
  stopDb,
  clearDb,
  signupBody,
  createUser,
  createLegacyUser,
  sha256,
  randomToken,
  extractToken,
  lastEmail,
  getUserRaw,
  signJwtFor,
  User,
  mongoose,
};
