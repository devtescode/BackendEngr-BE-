// Shared test harness: in-memory MongoDB, a fresh Express app with only the
// user routes mounted, and a stubbed email module that records messages.
// Never requires index.js (that starts a server and connects to Atlas).

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.ADMIN_JWT_SECRET = "test-admin-jwt-secret";

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
// Cloudinary stub — replaces config/cloudinary.js in require.cache BEFORE any
// route/controller/util loads it, so no test can ever reach real Cloudinary.
// Records every upload_stream/destroy call (in order) and can be toggled to
// fail. Optional async hooks (onUpload/onDestroy) run at call time; their
// results are stored on the event so tests can snapshot DB state "when" the
// call happened. Await cloudinaryStub.settle() before inspecting hook results.
// ---------------------------------------------------------------------------
const cloudinaryStub = {
  events: [], // { type: "upload"|"destroy", ... } in call order
  uploadMode: "ok", // "ok" | "fail"
  destroyMode: "ok", // "ok" | "fail"
  onUpload: null,
  onDestroy: null,
  pending: [],
  counter: 0,
  reset() {
    this.events.length = 0;
    this.pending.length = 0;
    this.uploadMode = "ok";
    this.destroyMode = "ok";
    this.onUpload = null;
    this.onDestroy = null;
  },
  uploads() {
    return this.events.filter((e) => e.type === "upload");
  },
  destroys() {
    return this.events.filter((e) => e.type === "destroy");
  },
  async settle() {
    await Promise.all(this.pending.slice());
  },
};

const fakeCloudinary = {
  config() {},
  uploader: {
    upload_stream(options, cb) {
      if (typeof options === "function") {
        cb = options;
        options = {};
      }
      return {
        end(buffer) {
          const ev = { type: "upload", options, size: buffer ? buffer.length : 0 };
          cloudinaryStub.events.push(ev);
          const fail = cloudinaryStub.uploadMode === "fail";
          let result;
          if (!fail) {
            cloudinaryStub.counter += 1;
            const folder = (options && options.folder) || "root";
            const public_id = `${folder}/stub-${process.pid}-${cloudinaryStub.counter}`;
            result = {
              public_id,
              secure_url: `https://res.cloudinary.com/stub/image/upload/v1/${public_id}.jpg`,
            };
            ev.result = result;
          }
          const hook = cloudinaryStub.onUpload
            ? Promise.resolve(cloudinaryStub.onUpload(ev)).then((r) => { ev.hook = r; })
            : Promise.resolve();
          cloudinaryStub.pending.push(hook);
          hook.then(() => {
            if (fail) cb(Object.assign(new Error("stubbed cloudinary upload failure"), { http_code: 500 }));
            else cb(undefined, result);
          });
        },
      };
    },
    destroy(publicId, opts, cb) {
      if (typeof opts === "function") {
        cb = opts;
        opts = undefined;
      }
      const ev = { type: "destroy", publicId, opts };
      cloudinaryStub.events.push(ev);
      const fail = cloudinaryStub.destroyMode === "fail";
      const hook = cloudinaryStub.onDestroy
        ? Promise.resolve(cloudinaryStub.onDestroy(ev)).then((r) => { ev.hook = r; })
        : Promise.resolve();
      cloudinaryStub.pending.push(hook);
      const p = hook.then(() => {
        if (fail) throw Object.assign(new Error("stubbed cloudinary destroy failure"), { http_code: 500 });
        return { result: "ok" };
      });
      if (typeof cb === "function") {
        p.then((r) => cb(undefined, r), (e) => cb(e));
        return undefined;
      }
      return p;
    },
  },
};

const cloudinaryPath = require.resolve(path.join(__dirname, "..", "config", "cloudinary.js"));
const cloudinaryModule = new Module(cloudinaryPath, module);
cloudinaryModule.filename = cloudinaryPath;
cloudinaryModule.loaded = true;
cloudinaryModule.exports = fakeCloudinary;
require.cache[cloudinaryPath] = cloudinaryModule;

// ---------------------------------------------------------------------------
// App + DB
// ---------------------------------------------------------------------------
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");

const userRoutes = require("../Routes/user.routes");
const User = require("../Models/user.models");

// Options (all optional; default is the original user-routes-only app):
//   admin: true      also mount Routes/user.adminRoutes.js at /admin
//   io: {emit()}     attach as req.io (like index.js does with socket.io)
//   trustProxy: v    app.set("trust proxy", v) so tests can vary req.ip via
//                    X-Forwarded-For (per-IP rate limiter isolation)
function buildApp(opts = {}) {
  const app = express();
  if (opts.trustProxy !== undefined) app.set("trust proxy", opts.trustProxy);
  if (opts.io) {
    app.use((req, res, next) => {
      req.io = opts.io;
      next();
    });
  }
  app.use(express.json());
  app.use("/engineering", userRoutes);
  if (opts.admin) app.use("/admin", require("../Routes/user.adminRoutes"));
  return app;
}

function signAdminJwt(overrides = {}) {
  return jwt.sign(
    { id: new mongoose.Types.ObjectId().toString(), role: "admin", ...overrides },
    process.env.ADMIN_JWT_SECRET,
    { expiresIn: "1h" }
  );
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
  cloudinaryStub.reset();
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
  cloudinaryStub,
  signAdminJwt,
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
