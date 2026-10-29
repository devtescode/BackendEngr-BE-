// GET /admin/pickup/collected — pagination, sort, search, stats, userImage.
// Contract: C:\Users\TESCODE\Desktop\_evs\COLLECTED_CONTRACT.md
const { test, before, after, beforeEach, describe } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const h = require("./helpers");
const PaymentOrder = require("../Models/paymentOrder");

const URL_PATH = "/admin/pickup/collected";
const ADA_IMG = "https://res.cloudinary.com/demo/image/upload/ada.jpg";
const ADA_PUBLIC_ID = "euhardwarestore-profile-images/ada-secret-public-id";

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

function get(query = {}, token = adminToken) {
  const r = request(app).get(URL_PATH).query(query);
  return token ? r.set("Authorization", `Bearer ${token}`) : r;
}

const BASE = Date.UTC(2026, 0, 1, 12, 0, 0);
const day = (n) => new Date(BASE + n * 24 * 60 * 60 * 1000);

// Seeds 7 collected+paid orders (O1..O7, collectedAt day 1..7) plus
// excluded orders that would otherwise match the searches below.
async function seed() {
  const { user: ada } = await h.createUser({
    fullName: "Ada Lovelace",
    matric: "ENG/1001",
    email: "ada.l@example.com",
    profileImageUrl: ADA_IMG,
    profileImagePublicId: ADA_PUBLIC_ID,
  });
  const { user: bola } = await h.createUser({
    fullName: "Bola Ahmed",
    matric: "ZXQ/2002",
    email: "bola.a@example.com",
  });
  const { user: chidi } = await h.createUser({
    fullName: "Chidi Okafor",
    matric: "ENG/3003",
    email: "chidi.mailbox@uni.edu",
    profileImageUrl: "http://insecure.example.com/chidi.jpg",
  });
  const { user: dayo } = await h.createUser({
    fullName: "Dayo Excluded",
    matric: "EXC/4004",
    email: "dayo.x@example.com",
  });

  const item = (name, quantity, price = 1000) => ({ name, quantity, price });
  const specs = [
    // [key, user, reference, items, amountKobo]
    ["O1", ada, "CK-0001", [item("Resistor Pack", 2)], 5000],
    ["O2", bola, "CK-0002", [item("Capacitor Kit", 1)], 70000],
    ["O3", chidi, "CK-0003", [item("Arduino Uno", 1), item("Jumper Wires", 3)], 30000],
    ["O4", ada, "CK-0004", [item("Breadboard", 5)], 10000],
    ["O5", bola, "SPECIAL-REF-XYZ", [item("LED Strip", 1)], 60000],
    ["O6", chidi, "CK-0006", [item("Servo Motor", 2)], 20000],
    ["O7", ada, "CK-0007", [item("Multimeter", 3)], 40000],
  ];
  const o = {};
  for (let i = 0; i < specs.length; i++) {
    const [key, user, reference, items, amount] = specs[i];
    const doc = await PaymentOrder.create({
      userId: user._id,
      reference,
      items,
      amount,
      paymentStatus: "paid",
      pickupStatus: "Collected",
      paystackPaidAt: day(i),
      collectedAt: day(i + 1),
    });
    o[key] = String(doc._id);
  }

  // Excluded: not paid, or not collected. Some deliberately match searches.
  await PaymentOrder.create([
    { userId: dayo._id, reference: "CK-X-READY", items: [item("Arduino Uno", 9)], amount: 999900,
      paymentStatus: "paid", pickupStatus: "Ready" },
    { userId: dayo._id, reference: "CK-X-PENDING", items: [item("Arduino Uno", 9)], amount: 999900,
      paymentStatus: "pending", pickupStatus: "Collected", collectedAt: day(100) },
    { userId: ada._id, reference: "SPECIAL-REF-FAILED", items: [item("Arduino Uno", 9)], amount: 999900,
      paymentStatus: "failed", pickupStatus: "Collected", collectedAt: day(101) },
    { userId: ada._id, reference: "CK-X-PAIDONLY", items: [item("Multimeter", 9)], amount: 999900,
      paymentStatus: "paid", pickupStatus: "Paid" },
  ]);

  return { o, ada, bola, chidi, dayo };
}

const ids = (res) => res.body.orders.map((x) => x.id);

function assertPagination(res, expected) {
  assert.deepEqual(res.body.pagination, expected);
  assert.equal(res.body.count, res.body.orders.length);
}

// ---------------------------------------------------------------------------
describe("auth", () => {
  test("401 without an admin token", async () => {
    const res = await get({}, null);
    assert.equal(res.status, 401);
    assert.equal(res.body.orders, undefined);
  });

  test("401 with an invalid token", async () => {
    const res = await get({}, "not-a-jwt");
    assert.equal(res.status, 401);
  });

  test("403 with a non-admin role token", async () => {
    const res = await get({}, h.signAdminJwt({ role: "student" }));
    assert.equal(res.status, 403);
  });
});

// ---------------------------------------------------------------------------
describe("pagination", () => {
  test("default page=1 limit=4 returns the 4 most recent collected+paid orders", async () => {
    const { o } = await seed();
    const res = await get();
    assert.equal(res.status, 200);
    assert.equal(res.body.message, "Collected orders fetched");
    assert.deepEqual(ids(res), [o.O7, o.O6, o.O5, o.O4]);
    assertPagination(res, { page: 1, limit: 4, totalItems: 7, totalPages: 2 });
    for (const ord of res.body.orders) assert.equal(ord.status, "Collected");
  });

  test("page 2 returns the next 3", async () => {
    const { o } = await seed();
    const res = await get({ page: 2 });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), [o.O3, o.O2, o.O1]);
    assertPagination(res, { page: 2, limit: 4, totalItems: 7, totalPages: 2 });
  });

  test("page beyond range clamps to the last page", async () => {
    const { o } = await seed();
    const res = await get({ page: 99 });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), [o.O3, o.O2, o.O1]);
    assertPagination(res, { page: 2, limit: 4, totalItems: 7, totalPages: 2 });
  });

  for (const bad of ["0", "-1", "abc", "1.5x", ""]) {
    test(`invalid page ${JSON.stringify(bad)} -> page 1`, async () => {
      const { o } = await seed();
      const res = await get({ page: bad });
      assert.equal(res.status, 200);
      assert.equal(res.body.pagination.page, 1);
      assert.deepEqual(ids(res), [o.O7, o.O6, o.O5, o.O4]);
    });
  }

  test('limit "abc" -> default 4', async () => {
    await seed();
    const res = await get({ limit: "abc" });
    assert.equal(res.status, 200);
    assertPagination(res, { page: 1, limit: 4, totalItems: 7, totalPages: 2 });
    assert.equal(res.body.orders.length, 4);
  });

  // The contract says "integer 1..50, default 4; invalid -> default", while
  // the referenced getPaginatedComponents clamps. Out-of-range values must
  // land on either the default (4) or the nearest bound — never pass through.
  for (const [bad, allowed] of [["0", [1, 4]], ["-1", [1, 4]], ["999", [50, 4]]]) {
    test(`limit ${bad} -> sanitized to one of ${allowed.join("/")}`, async () => {
      await seed();
      const res = await get({ limit: bad });
      assert.equal(res.status, 200);
      const { limit } = res.body.pagination;
      assert.ok(allowed.includes(limit), `limit was ${limit}`);
      assertPagination(res, {
        page: 1,
        limit,
        totalItems: 7,
        totalPages: Math.ceil(7 / limit),
      });
      assert.equal(res.body.orders.length, Math.min(7, limit));
    });
  }

  test("limit 50 is allowed and returns all 7", async () => {
    await seed();
    const res = await get({ limit: 50 });
    assert.equal(res.status, 200);
    assertPagination(res, { page: 1, limit: 50, totalItems: 7, totalPages: 1 });
    assert.equal(res.body.orders.length, 7);
  });

  test("limit 1 page 7 returns the oldest", async () => {
    const { o } = await seed();
    const res = await get({ limit: 1, page: 7 });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), [o.O1]);
    assertPagination(res, { page: 7, limit: 1, totalItems: 7, totalPages: 7 });
  });

  test("limit 3 paginates 3/3/1", async () => {
    const { o } = await seed();
    const p3 = await get({ limit: 3, page: 3 });
    assert.deepEqual(ids(p3), [o.O1]);
    assertPagination(p3, { page: 3, limit: 3, totalItems: 7, totalPages: 3 });
  });

  test("empty result -> totalItems 0, totalPages 0, page 1, zero stats", async () => {
    const res = await get({ page: 5 });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.orders, []);
    assertPagination(res, { page: 1, limit: 4, totalItems: 0, totalPages: 0 });
    assert.deepEqual(res.body.stats, { orders: 0, students: 0, items: 0, value: 0 });
  });

  test("only excluded orders -> empty result", async () => {
    await seed();
    await PaymentOrder.deleteMany({ paymentStatus: "paid", pickupStatus: "Collected" });
    const res = await get();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.orders, []);
    assertPagination(res, { page: 1, limit: 4, totalItems: 0, totalPages: 0 });
    assert.deepEqual(res.body.stats, { orders: 0, students: 0, items: 0, value: 0 });
  });
});

// ---------------------------------------------------------------------------
describe("sort", () => {
  test("sort=recent (explicit) equals default", async () => {
    const { o } = await seed();
    const res = await get({ sort: "recent" });
    assert.deepEqual(ids(res), [o.O7, o.O6, o.O5, o.O4]);
  });

  test("sort=oldest", async () => {
    const { o } = await seed();
    const p1 = await get({ sort: "oldest" });
    assert.equal(p1.status, 200);
    assert.deepEqual(ids(p1), [o.O1, o.O2, o.O3, o.O4]);
    const p2 = await get({ sort: "oldest", page: 2 });
    assert.deepEqual(ids(p2), [o.O5, o.O6, o.O7]);
    assertPagination(p2, { page: 2, limit: 4, totalItems: 7, totalPages: 2 });
  });

  test("sort=highest (amount desc)", async () => {
    const { o } = await seed();
    const p1 = await get({ sort: "highest" });
    assert.equal(p1.status, 200);
    assert.deepEqual(ids(p1), [o.O2, o.O5, o.O7, o.O3]);
    const p2 = await get({ sort: "highest", page: 2 });
    assert.deepEqual(ids(p2), [o.O6, o.O4, o.O1]);
  });

  test("unknown sort falls back to recent", async () => {
    const { o } = await seed();
    const res = await get({ sort: "$where" });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), [o.O7, o.O6, o.O5, o.O4]);
  });
});

// ---------------------------------------------------------------------------
describe("search q", () => {
  test("matches reference (case-insensitive)", async () => {
    const { o } = await seed();
    const res = await get({ q: "special-ref" });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), [o.O5]);
    assertPagination(res, { page: 1, limit: 4, totalItems: 1, totalPages: 1 });
    assert.deepEqual(res.body.stats, { orders: 1, students: 1, items: 1, value: 600 });
  });

  test("matches item name (case-insensitive)", async () => {
    const { o } = await seed();
    const res = await get({ q: "ARDUINO" });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), [o.O3]);
    assert.deepEqual(res.body.stats, { orders: 1, students: 1, items: 4, value: 300 });
  });

  test("matches student fullName (case-insensitive, trimmed)", async () => {
    const { o } = await seed();
    const res = await get({ q: "   LOVELACE  " });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), [o.O7, o.O4, o.O1]);
    assertPagination(res, { page: 1, limit: 4, totalItems: 3, totalPages: 1 });
    assert.deepEqual(res.body.stats, { orders: 3, students: 1, items: 10, value: 550 });
  });

  test("matches matric (case-insensitive)", async () => {
    const { o } = await seed();
    const res = await get({ q: "zxq/2002" });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), [o.O5, o.O2]);
    assert.deepEqual(res.body.stats, { orders: 2, students: 1, items: 2, value: 1300 });
  });

  test("matches email (case-insensitive)", async () => {
    const { o } = await seed();
    const res = await get({ q: "CHIDI.MAILBOX@UNI" });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), [o.O6, o.O3]);
    assert.deepEqual(res.body.stats, { orders: 2, students: 1, items: 6, value: 500 });
  });

  test("matches several students via shared matric prefix", async () => {
    const { o } = await seed();
    const res = await get({ q: "eng/" });
    assert.equal(res.status, 200);
    // Ada (O1,O4,O7) + Chidi (O3,O6)
    assert.deepEqual(ids(res), [o.O7, o.O6, o.O4, o.O3]);
    assertPagination(res, { page: 1, limit: 4, totalItems: 5, totalPages: 2 });
    assert.deepEqual(res.body.stats, { orders: 5, students: 2, items: 16, value: 1050 });
  });

  test("q combines with pagination and sort", async () => {
    const { o } = await seed();
    const res = await get({ q: "lovelace", limit: 2, page: 2, sort: "highest" });
    assert.equal(res.status, 200);
    // Ada: O7 40000, O4 10000, O1 5000
    assert.deepEqual(ids(res), [o.O1]);
    assertPagination(res, { page: 2, limit: 2, totalItems: 3, totalPages: 2 });
    assert.deepEqual(res.body.stats, { orders: 3, students: 1, items: 10, value: 550 });
  });

  test("users with only excluded orders do not appear", async () => {
    await seed();
    const res = await get({ q: "dayo" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.orders, []);
    assertPagination(res, { page: 1, limit: 4, totalItems: 0, totalPages: 0 });
    assert.deepEqual(res.body.stats, { orders: 0, students: 0, items: 0, value: 0 });
  });

  for (const q of ["(", "[", "*", "+", "?", "\\", "(.*", "a{2", ".*", "^", "$", "|"]) {
    test(`regex metacharacters ${JSON.stringify(q)} do not crash and match literally`, async () => {
      await seed();
      const res = await get({ q });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      // None of these literal strings occur in any seeded searchable field
      // (emails/refs contain "." and "-" but no regex metachars listed here
      // except "." in ".*", which as a literal ".*" occurs nowhere).
      assertPagination(res, { page: 1, limit: 4, totalItems: 0, totalPages: 0 });
      assert.deepEqual(res.body.orders, []);
    });
  }

  test("a literal '.' matches only literal dots (escaped)", async () => {
    const { o } = await seed();
    const res = await get({ q: "ada.l" });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), [o.O7, o.O4, o.O1]);
    const probe = await get({ q: "ada.lovelace" }); // unescaped would match "Ada Lovelace"
    assert.equal(probe.status, 200);
    assert.equal(probe.body.pagination.totalItems, 0);
  });

  test("q longer than 100 chars does not crash", async () => {
    await seed();
    const res = await get({ q: "x".repeat(5000) });
    assert.equal(res.status, 200);
    assert.equal(res.body.pagination.totalItems, 0);
  });

  test("q is truncated to 100 chars", async () => {
    const { o } = await seed();
    // 100 matching chars followed by garbage only matches if q is cut at 100.
    await PaymentOrder.updateOne({ _id: o.O1 }, { $set: { reference: "R".repeat(100) } });
    const res = await get({ q: "r".repeat(100) + "ZZZZ" });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), [o.O1]);
  });

  test("array / object q does not crash", async () => {
    await seed();
    const a = await request(app).get(`${URL_PATH}?q=a&q=b`).set("Authorization", `Bearer ${adminToken}`);
    assert.equal(a.status, 200);
    const b = await request(app).get(`${URL_PATH}?q[$ne]=x`).set("Authorization", `Bearer ${adminToken}`);
    assert.equal(b.status, 200);
  });

  test("empty q returns everything", async () => {
    await seed();
    const res = await get({ q: "   " });
    assert.equal(res.status, 200);
    assert.equal(res.body.pagination.totalItems, 7);
  });
});

// ---------------------------------------------------------------------------
describe("stats", () => {
  test("stats are over the whole filtered set, not the page", async () => {
    await seed();
    const expected = { orders: 7, students: 3, items: 18, value: 2350 };
    const p1 = await get();
    assert.deepEqual(p1.body.stats, expected);
    const p2 = await get({ page: 2, sort: "highest", limit: 1 });
    assert.deepEqual(p2.body.stats, expected);
  });
});

// ---------------------------------------------------------------------------
describe("shape + privacy", () => {
  test("order shape, userImage https-only", async () => {
    const { o, ada, bola, chidi } = await seed();
    const res = await get({ limit: 50 });
    assert.equal(res.status, 200);
    const byId = Object.fromEntries(res.body.orders.map((x) => [x.id, x]));

    const o7 = byId[o.O7];
    assert.equal(o7.reference, "CK-0007");
    assert.equal(o7.userId, String(ada._id));
    assert.equal(o7.userName, "Ada Lovelace");
    assert.equal(o7.matric, "ENG/1001");
    assert.equal(o7.email, "ada.l@example.com");
    assert.equal(o7.total, 400);
    assert.equal(o7.status, "Collected");
    assert.equal(new Date(o7.collectedAt).getTime(), day(7).getTime());
    assert.equal(o7.items.length, 1);
    assert.equal(o7.items[0].name, "Multimeter");
    assert.equal(o7.items[0].quantity, 3);
    assert.equal(o7.userImage, ADA_IMG);

    assert.equal(byId[o.O2].userId, String(bola._id));
    assert.ok("userImage" in byId[o.O2], "userImage key present");
    assert.equal(byId[o.O2].userImage, null);

    assert.equal(byId[o.O3].userId, String(chidi._id));
    assert.equal(byId[o.O3].userImage, null, "http:// image must be null");
  });

  test("response never contains profileImagePublicId or password", async () => {
    const { ada } = await seed();
    const raw = await h.getUserRaw({ _id: ada._id });
    assert.equal(raw.profileImagePublicId, ADA_PUBLIC_ID, "fixture stored public id");
    for (const query of [{}, { limit: 50 }, { q: "lovelace" }, { sort: "highest" }]) {
      const res = await get(query);
      assert.equal(res.status, 200);
      const text = res.text;
      assert.ok(!text.includes("profileImagePublicId"), "no profileImagePublicId key");
      assert.ok(!text.includes(ADA_PUBLIC_ID), "no public id value");
      assert.ok(!/password/i.test(text), "no password key");
      assert.ok(!text.includes(raw.password), "no password hash");
      assert.ok(!/token/i.test(text), "no token fields");
    }
  });
});
