// POST /verify-email/:token and the verifyToken middleware.
// Keep verify requests <= 20 and signups <= 10 in this file.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const h = require("./helpers");

let app;
before(async () => {
  await h.startDb();
  app = h.buildApp();
});
after(h.stopDb);
beforeEach(h.clearDb);

async function seedUnverifiedWithToken({ expiresInMs = 24 * 3600e3 } = {}) {
  const { user, body, password } = await h.createUser({ verified: false });
  const raw = h.randomToken();
  await h.User.collection.updateOne(
    { _id: user._id },
    {
      $set: {
        emailVerificationToken: h.sha256(raw),
        emailVerificationExpires: new Date(Date.now() + expiresInMs),
        emailVerificationSentAt: new Date(),
      },
    }
  );
  return { user, body, password, raw };
}

test("signup -> verify valid token -> EMAIL_VERIFIED; reuse -> ALREADY_VERIFIED; then login 200", async () => {
  const body = h.signupBody();
  const s = await request(app).post("/engineering/usersignup").send(body);
  assert.equal(s.status, 201);
  const raw = h.extractToken(h.lastEmail(), "verify-email");
  assert.ok(raw);

  const v1 = await request(app).post(`/engineering/verify-email/${raw}`);
  assert.equal(v1.status, 200);
  assert.equal(v1.body.success, true);
  assert.equal(v1.body.code, "EMAIL_VERIFIED");

  const doc = await h.getUserRaw({ email: body.email });
  assert.equal(doc.isEmailVerified, true);
  assert.ok(doc.emailVerifiedAt instanceof Date);
  assert.equal(doc.emailVerificationExpires, undefined, "expiry unset");
  assert.equal(doc.emailVerificationSentAt, undefined, "sentAt unset");
  assert.equal(doc.emailVerificationToken, h.sha256(raw), "hash kept for ALREADY_VERIFIED");

  const v2 = await request(app).post(`/engineering/verify-email/${raw}`);
  assert.equal(v2.status, 200);
  assert.equal(v2.body.success, true);
  assert.equal(v2.body.code, "ALREADY_VERIFIED");

  const login = await request(app).post("/engineering/userlogin").send({ email: body.email, password: body.password });
  assert.equal(login.status, 200);
  assert.equal(typeof login.body.token, "string");
});

test("GET on verify-email is not a verification endpoint (link scanners cannot consume it)", async () => {
  const { raw, user } = await seedUnverifiedWithToken();
  await request(app).get(`/engineering/verify-email/${raw}`);
  const doc = await h.getUserRaw({ _id: user._id });
  assert.notEqual(doc.isEmailVerified, true);
});

test("expired token -> 400 TOKEN_EXPIRED with email; user stays unverified", async () => {
  const { raw, body, user } = await seedUnverifiedWithToken({ expiresInMs: -60_000 });
  const res = await request(app).post(`/engineering/verify-email/${raw}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "TOKEN_EXPIRED");
  assert.equal(res.body.email, body.email);
  const doc = await h.getUserRaw({ _id: user._id });
  assert.equal(doc.isEmailVerified, false);
});

test("malformed tokens -> 400 TOKEN_INVALID", async () => {
  for (const bad of ["abc", "Z".repeat(64)]) {
    const res = await request(app).post(`/engineering/verify-email/${bad}`);
    assert.equal(res.status, 400, `token ${bad}`);
    assert.equal(res.body.code, "TOKEN_INVALID");
  }
});

test("unknown well-formed token -> 400 TOKEN_INVALID", async () => {
  await seedUnverifiedWithToken();
  const res = await request(app).post(`/engineering/verify-email/${h.randomToken()}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "TOKEN_INVALID");
});

test("concurrent verify requests with the same token both succeed (one EMAIL_VERIFIED)", async () => {
  const { raw, user } = await seedUnverifiedWithToken();
  const results = await Promise.all([
    request(app).post(`/engineering/verify-email/${raw}`),
    request(app).post(`/engineering/verify-email/${raw}`),
    request(app).post(`/engineering/verify-email/${raw}`),
  ]);
  for (const r of results) {
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(["EMAIL_VERIFIED", "ALREADY_VERIFIED"].includes(r.body.code), r.body.code);
  }
  const verifiedCount = results.filter((r) => r.body.code === "EMAIL_VERIFIED").length;
  assert.equal(verifiedCount, 1, "exactly one request performs the verification");
  const doc = await h.getUserRaw({ _id: user._id });
  assert.equal(doc.isEmailVerified, true);
});

test("verifyToken rejects a valid JWT of an unverified user with 403 EMAIL_NOT_VERIFIED", async () => {
  const { user } = await h.createUser({ verified: false });
  const jwtToken = h.signJwtFor(user);
  const res = await request(app).get("/engineering/cart").set("Authorization", `Bearer ${jwtToken}`);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "EMAIL_NOT_VERIFIED");

  const res2 = await request(app)
    .post("/engineering/changepassword")
    .set("Authorization", `Bearer ${jwtToken}`)
    .send({ currentPassword: "Password123!", newPassword: "NewPassword123!" });
  assert.equal(res2.status, 403);
  assert.equal(res2.body.code, "EMAIL_NOT_VERIFIED");
});

test("verifyToken rejects a JWT of a legacy user (field missing) with 403", async () => {
  const { id, body } = await h.createLegacyUser();
  const jwtToken = h.signJwtFor({ _id: id, email: body.email });
  const res = await request(app).get("/engineering/cart").set("Authorization", `Bearer ${jwtToken}`);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "EMAIL_NOT_VERIFIED");
});

test("verifyToken accepts a verified user's JWT from login", async () => {
  const { body, password } = await h.createUser({ verified: true });
  const login = await request(app).post("/engineering/userlogin").send({ email: body.email, password });
  assert.equal(login.status, 200);
  const res = await request(app).get("/engineering/cart").set("Authorization", `Bearer ${login.body.token}`);
  assert.equal(res.status, 200);
});

test("verifyToken returns 401 when the JWT's user no longer exists", async () => {
  const { user } = await h.createUser({ verified: true });
  const jwtToken = h.signJwtFor(user);
  await h.User.deleteOne({ _id: user._id });
  const res = await request(app).get("/engineering/cart").set("Authorization", `Bearer ${jwtToken}`);
  assert.equal(res.status, 401);
});
