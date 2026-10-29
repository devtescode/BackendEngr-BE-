// Admin cart listing (getAllCarts filtering) + cart socket rooms/broadcasts.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const h = require("./helpers");

const Cart = require("../Models/cart");
const Component = require("../Models/component");

// Fake socket.io server: records io.to(room).emit(...) and io.emit(...).
const ioEvents = [];
const fakeIo = {
  to(room) {
    return {
      emit(event, payload) {
        ioEvents.push({ room, event, payload });
        return true;
      },
    };
  },
  emit(event, payload) {
    ioEvents.push({ room: null, event, payload });
    return true;
  },
};

let app;
before(async () => {
  await h.startDb();
  await Promise.all([Cart.init(), Component.init()]);
  app = h.buildApp({ admin: true, io: fakeIo });
});
after(h.stopDb);
beforeEach(async () => {
  await h.clearDb();
  await Cart.deleteMany({});
  await Component.deleteMany({});
  ioEvents.length = 0;
});

let skuSeq = 0;
async function createComponent(overrides = {}) {
  skuSeq += 1;
  return Component.create({
    sku: `SKU-${process.pid}-${skuSeq}`,
    name: `Component ${skuSeq}`,
    category: "Sensors",
    price: 1500,
    stock: 20,
    ...overrides,
  });
}

function adminGetCarts() {
  return request(app).get("/admin/getallcarts").set("Authorization", `Bearer ${h.signAdminJwt()}`);
}

const idOf = (v) => (v && typeof v === "object" ? String(v._id) : String(v));

// ---------------------------------------------------------------------------
// GET /admin/getallcarts
// ---------------------------------------------------------------------------

test("getallcarts requires an admin token", async () => {
  const r = await request(app).get("/admin/getallcarts");
  assert.equal(r.status, 401);
});

test("getallcarts includes the student's profileImageUrl but never the Cloudinary public id", async () => {
  const User = require("../Models/user.models");
  const { user } = await h.createUser({ verified: true });
  await User.updateOne(
    { _id: user._id },
    { $set: { profileImageUrl: "https://res.cloudinary.com/demo/image/upload/p.webp", profileImagePublicId: "euhardwarestore-profile-images/p" } }
  );
  const c1 = await createComponent({ name: "Servo", price: 3000 });
  await Cart.create({ userId: user._id, items: [{ componentId: c1._id, quantity: 1 }] });

  const r = await adminGetCarts();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.carts[0].userId.profileImageUrl, "https://res.cloudinary.com/demo/image/upload/p.webp");
  assert.ok(!JSON.stringify(r.body).includes("profileImagePublicId"), "public id field never exposed");
  assert.ok(!JSON.stringify(r.body).includes("euhardwarestore-profile-images/p\""), "public id value never exposed");
});

test("getallcarts returns normal carts with populated user and items", async () => {
  const { user } = await h.createUser({ verified: true, fullName: "Ada Student" });
  const c1 = await createComponent({ name: "Arduino Uno", price: 12000 });
  const c2 = await createComponent({ name: "DHT11", price: 2500 });
  await Cart.create({
    userId: user._id,
    items: [
      { componentId: c1._id, quantity: 2 },
      { componentId: c2._id, quantity: 1 },
    ],
  });

  const r = await adminGetCarts();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body.carts));
  assert.equal(r.body.carts.length, 1);
  const cart = r.body.carts[0];
  assert.equal(typeof cart.userId, "object");
  assert.equal(String(cart.userId._id), String(user._id));
  assert.equal(cart.userId.fullName, "Ada Student");
  assert.equal(cart.userId.email, user.email);
  assert.equal(cart.userId.matric, user.matric);
  assert.equal(cart.userId.password, undefined, "password never exposed");
  assert.equal(cart.items.length, 2);
  const byName = Object.fromEntries(cart.items.map((i) => [i.componentId.name, i]));
  assert.equal(byName["Arduino Uno"].quantity, 2);
  assert.equal(byName["Arduino Uno"].componentId.price, 12000);
  assert.equal(String(byName["Arduino Uno"].componentId._id), String(c1._id));
  assert.equal(byName["DHT11"].quantity, 1);
  assert.equal(byName["DHT11"].componentId.sku, c2.sku);
});

test("getallcarts excludes carts whose user was deleted", async () => {
  const { user: alive } = await h.createUser({ verified: true });
  const { user: gone } = await h.createUser({ verified: true });
  const comp = await createComponent();
  await Cart.create({ userId: alive._id, items: [{ componentId: comp._id, quantity: 1 }] });
  await Cart.create({ userId: gone._id, items: [{ componentId: comp._id, quantity: 3 }] });
  // Orphan cart referencing a user id that never existed.
  await Cart.create({ userId: new h.mongoose.Types.ObjectId(), items: [{ componentId: comp._id, quantity: 1 }] });
  await h.User.deleteOne({ _id: gone._id });

  const r = await adminGetCarts();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.carts.length, 1, JSON.stringify(r.body.carts));
  assert.equal(String(r.body.carts[0].userId._id), String(alive._id));
  for (const c of r.body.carts) assert.ok(c.userId, "no cart with a null user");
});

test("getallcarts drops items whose component was deleted, and carts left empty", async () => {
  const { user: mixedOwner } = await h.createUser({ verified: true });
  const { user: staleOwner } = await h.createUser({ verified: true });
  const keep = await createComponent({ name: "Keep Me" });
  const removed = await createComponent({ name: "Deleted Part" });
  await Cart.create({
    userId: mixedOwner._id,
    items: [
      { componentId: keep._id, quantity: 1 },
      { componentId: removed._id, quantity: 4 },
    ],
  });
  await Cart.create({ userId: staleOwner._id, items: [{ componentId: removed._id, quantity: 2 }] });
  await Component.deleteOne({ _id: removed._id });

  const r = await adminGetCarts();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.carts.length, 1, JSON.stringify(r.body.carts));
  const cart = r.body.carts[0];
  assert.equal(String(cart.userId._id), String(mixedOwner._id));
  assert.equal(cart.items.length, 1, JSON.stringify(cart.items));
  assert.ok(cart.items[0].componentId, "remaining item is populated");
  assert.equal(cart.items[0].componentId.name, "Keep Me");
  assert.equal(String(cart.items[0].componentId._id), String(keep._id));
});

test("getallcarts still excludes carts that are already empty", async () => {
  const { user } = await h.createUser({ verified: true });
  await Cart.create({ userId: user._id, items: [] });
  const r = await adminGetCarts();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.carts, []);
});

// ---------------------------------------------------------------------------
// Socket events from the student cart endpoints
// ---------------------------------------------------------------------------

function assertCartSocketEvents(userId, { itemCount } = {}) {
  const room = String(userId);
  const toUser = ioEvents.filter((e) => e.event === "cart:updated");
  assert.equal(toUser.length, 1, `one cart:updated, got ${JSON.stringify(ioEvents.map((e) => [e.room, e.event]))}`);
  assert.equal(toUser[0].room, room, `cart:updated must go to room "${room}" (the id index.js joins), not "${toUser[0].room}"`);
  assert.ok(toUser[0].payload, "cart:updated carries the cart");
  if (itemCount !== undefined) assert.equal(toUser[0].payload.items.length, itemCount);
  assert.ok(!ioEvents.some((e) => typeof e.room === "string" && e.room.startsWith("user:")), "no legacy user:<id> room");

  const broadcast = ioEvents.filter((e) => e.event === "carts:changed");
  assert.equal(broadcast.length, 1, "one carts:changed broadcast");
  assert.equal(broadcast[0].room, null, "carts:changed is broadcast via io.emit, not to a room");
}

test("POST /engineering/addtocart emits cart:updated to the user's id room and broadcasts carts:changed", async () => {
  const { user } = await h.createUser({ verified: true });
  const comp = await createComponent();
  const r = await request(app)
    .post("/engineering/addtocart")
    .set("Authorization", `Bearer ${h.signJwtFor(user)}`)
    .send({ componentId: String(comp._id), quantity: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cart.items.length, 1);
  assert.equal(r.body.cart.items[0].quantity, 2);
  assertCartSocketEvents(user._id, { itemCount: 1 });
});

test("PUT /engineering/cart/:componentId emits cart:updated to the user's id room and broadcasts carts:changed", async () => {
  const { user } = await h.createUser({ verified: true });
  const comp = await createComponent();
  await Cart.create({ userId: user._id, items: [{ componentId: comp._id, quantity: 1 }] });
  const r = await request(app)
    .put(`/engineering/cart/${comp._id}`)
    .set("Authorization", `Bearer ${h.signJwtFor(user)}`)
    .send({ quantity: 5 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cart.items[0].quantity, 5);
  assertCartSocketEvents(user._id, { itemCount: 1 });
  assert.equal(ioEvents.find((e) => e.event === "cart:updated").payload.items[0].quantity, 5);
});

test("DELETE /engineering/cart/:componentId emits cart:updated to the user's id room and broadcasts carts:changed", async () => {
  const { user } = await h.createUser({ verified: true });
  const a = await createComponent();
  const b = await createComponent();
  await Cart.create({
    userId: user._id,
    items: [
      { componentId: a._id, quantity: 1 },
      { componentId: b._id, quantity: 1 },
    ],
  });
  const r = await request(app)
    .delete(`/engineering/cart/${a._id}`)
    .set("Authorization", `Bearer ${h.signJwtFor(user)}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cart.items.length, 1);
  assertCartSocketEvents(user._id, { itemCount: 1 });
});

test("failed cart mutations emit nothing", async () => {
  const { user } = await h.createUser({ verified: true });
  const r = await request(app)
    .post("/engineering/addtocart")
    .set("Authorization", `Bearer ${h.signJwtFor(user)}`)
    .send({ componentId: String(new h.mongoose.Types.ObjectId()), quantity: 1 });
  assert.equal(r.status, 404);
  assert.deepEqual(ioEvents, []);
});
