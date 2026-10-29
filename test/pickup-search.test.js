// GET /admin/pickup/search — student profile photo on each order.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const h = require("./helpers");
const PaymentOrder = require("../Models/paymentOrder");

const IMG = "https://res.cloudinary.com/demo/image/upload/student.webp";
const PUBLIC_ID = "euhardwarestore-profile-images/student-secret-id";

let app;
let adminToken;
before(async () => {
  await h.startDb();
  await PaymentOrder.init();
  app = h.buildApp({ admin: true });
  adminToken = h.signAdminJwt();
});
after(h.stopDb);
beforeEach(async () => {
  await h.clearDb();
  await PaymentOrder.deleteMany({});
});

const search = (q) =>
  request(app).get("/admin/pickup/search").query({ q }).set("Authorization", `Bearer ${adminToken}`);

async function paidOrder(user, reference) {
  return PaymentOrder.create({
    userId: user._id,
    reference,
    items: [{ name: "Arduino Uno", quantity: 1, price: 12000 }],
    amount: 1200000,
    paymentStatus: "paid",
    pickupStatus: "Paid",
  });
}

test("pickup search returns the student's https profile photo as userImage", async () => {
  const { user } = await h.createUser({
    matric: "ENG/5005",
    profileImageUrl: IMG,
    profileImagePublicId: PUBLIC_ID,
  });
  await paidOrder(user, "PK-PHOTO-1");

  const r = await search("ENG/5005");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.orders.length, 1);
  assert.equal(r.body.orders[0].userImage, IMG);

  const raw = JSON.stringify(r.body);
  assert.ok(!raw.includes("profileImagePublicId"), "public id field never exposed");
  assert.ok(!raw.includes(PUBLIC_ID), "public id value never exposed");
});

test("pickup search returns userImage null without a photo or for non-https URLs", async () => {
  const { user: none } = await h.createUser({ matric: "ENG/6006" });
  const { user: insecure } = await h.createUser({
    matric: "ENG/7007",
    profileImageUrl: "http://insecure.example.com/x.jpg",
  });
  await paidOrder(none, "PK-NONE-1");
  await paidOrder(insecure, "PK-HTTP-1");

  const a = await search("PK-NONE-1");
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.orders[0].userImage, null);

  const b = await search("ENG/7007");
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.orders[0].userImage, null);
});
