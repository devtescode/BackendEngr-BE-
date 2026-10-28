// Forgot/reset password interaction with email verification.
// Keep forgot-password requests <= 5 and reset requests <= 20 in this file.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const h = require("./helpers");

let app;
before(async () => {
  await h.startDb();
  app = h.buildApp();
});
after(h.stopDb);
beforeEach(h.clearDb);

async function seedStaleReset(userId) {
  const raw = h.randomToken();
  await h.User.collection.updateOne(
    { _id: userId },
    { $set: { passwordResetToken: h.sha256(raw), passwordResetExpires: new Date(Date.now() + 30 * 60e3) } }
  );
  return raw;
}

test("forgot-password for unverified user -> 403 EMAIL_NOT_VERIFIED, no email, stale reset token removed", async () => {
  const { user, body } = await h.createUser({ verified: false });
  await seedStaleReset(user._id);

  const r = await request(app).post("/engineering/forgot-password").send({ email: body.email.toUpperCase() });
  assert.equal(r.status, 403);
  assert.equal(r.body.success, false);
  assert.equal(r.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(r.body.email, body.email);
  assert.equal(h.emailStub.sent.length, 0);

  const doc = await h.getUserRaw({ _id: user._id });
  assert.equal(doc.passwordResetToken, undefined, "no reset token stored");
  assert.equal(doc.passwordResetExpires, undefined);
});

test("forgot-password for legacy user (field missing) -> 403 EMAIL_NOT_VERIFIED, no email", async () => {
  const { id, body } = await h.createLegacyUser();
  const r = await request(app).post("/engineering/forgot-password").send({ email: body.email });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(h.emailStub.sent.length, 0);
  const doc = await h.getUserRaw({ _id: id });
  assert.equal(doc.passwordResetToken, undefined);
});

test("forgot-password keeps 404 for unknown email", async () => {
  const r = await request(app).post("/engineering/forgot-password").send({ email: "nobody@example.com" });
  assert.equal(r.status, 404);
  assert.equal(h.emailStub.sent.length, 0);
});

test("stale reset token on unverified account: GET -> 403 and token unset", async () => {
  const { user, body } = await h.createUser({ verified: false });
  const raw = await seedStaleReset(user._id);

  const g = await request(app).get(`/engineering/reset-password/${raw}`);
  assert.equal(g.status, 403);
  assert.equal(g.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(g.body.email, body.email);
  const doc = await h.getUserRaw({ _id: user._id });
  assert.equal(doc.passwordResetToken, undefined, "reset token unset after GET");
});

test("stale reset token on unverified account: POST -> 403, password unchanged, token unset", async () => {
  const { user, body, password } = await h.createUser({ verified: false });
  const raw = await seedStaleReset(user._id);
  const before = await h.getUserRaw({ _id: user._id });

  const p = await request(app)
    .post(`/engineering/reset-password/${raw}`)
    .send({ password: "BrandNewPass123!", confirmPassword: "BrandNewPass123!" });
  assert.equal(p.status, 403);
  assert.equal(p.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(p.body.email, body.email);

  const doc = await h.getUserRaw({ _id: user._id });
  assert.equal(doc.password, before.password, "password hash unchanged");
  assert.ok(await bcrypt.compare(password, doc.password));
  assert.equal(doc.passwordResetToken, undefined, "reset token unset after POST");
  assert.ok(!doc.passwordChangedAt);
});

test("verified user: forgot-password sends email, reset works, old JWT rejected, new password logs in", async () => {
  const { body, password } = await h.createUser({ verified: true });

  const login1 = await request(app).post("/engineering/userlogin").send({ email: body.email, password });
  assert.equal(login1.status, 200);
  const oldJwt = login1.body.token;
  const ok = await request(app).get("/engineering/cart").set("Authorization", `Bearer ${oldJwt}`);
  assert.equal(ok.status, 200, "old JWT works before reset");

  const f = await request(app).post("/engineering/forgot-password").send({ email: body.email });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.equal(f.body.success, true);
  assert.equal(h.emailStub.sent.length, 1);
  assert.equal(h.lastEmail().to, body.email);
  const raw = h.extractToken(h.lastEmail(), "reset-password");
  assert.ok(raw, "reset email contains FRONTEND_URL/reset-password/<64hex>");

  const g = await request(app).get(`/engineering/reset-password/${raw}`);
  assert.equal(g.status, 200);

  const newPassword = "BrandNewPass123!";
  const p = await request(app)
    .post(`/engineering/reset-password/${raw}`)
    .send({ password: newPassword, confirmPassword: newPassword });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.success, true);

  const rejected = await request(app).get("/engineering/cart").set("Authorization", `Bearer ${oldJwt}`);
  assert.equal(rejected.status, 401, "old JWT rejected after reset");

  const loginOld = await request(app).post("/engineering/userlogin").send({ email: body.email, password });
  assert.equal(loginOld.status, 401);
  const loginNew = await request(app).post("/engineering/userlogin").send({ email: body.email, password: newPassword });
  assert.equal(loginNew.status, 200);
  const fresh = await request(app).get("/engineering/cart").set("Authorization", `Bearer ${loginNew.body.token}`);
  assert.equal(fresh.status, 200);

  const reuse = await request(app)
    .post(`/engineering/reset-password/${raw}`)
    .send({ password: "AnotherPass123!", confirmPassword: "AnotherPass123!" });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.code, "TOKEN_INVALID");
});
