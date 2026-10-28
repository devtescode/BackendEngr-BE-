// POST /resend-verification, part A. Keep resend requests <= 5 in this file.
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

const GENERIC = "If an unverified account exists for that email, a new verification link has been sent.";

test("resend replaces the token: old link -> TOKEN_INVALID, new link -> EMAIL_VERIFIED", async () => {
  const body = h.signupBody();
  const s = await request(app).post("/engineering/usersignup").send(body);
  assert.equal(s.status, 201);
  const oldRaw = h.extractToken(h.lastEmail(), "verify-email");
  assert.ok(oldRaw);

  // Move past the 60s cooldown.
  await h.User.collection.updateOne(
    { email: body.email },
    { $set: { emailVerificationSentAt: new Date(Date.now() - 61_000) } }
  );

  const r = await request(app).post("/engineering/resend-verification").send({ email: ` ${body.email.toUpperCase()} ` });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.success, true);
  assert.equal(r.body.code, "VERIFICATION_RESENT");
  assert.equal(r.body.message, GENERIC);
  assert.equal(r.body.retryAfterSeconds, 60);
  assert.equal(h.emailStub.sent.length, 2);
  assert.equal(h.lastEmail().to, body.email);
  const newRaw = h.extractToken(h.lastEmail(), "verify-email");
  assert.ok(newRaw);
  assert.notEqual(newRaw, oldRaw);

  const doc = await h.getUserRaw({ email: body.email });
  assert.equal(doc.emailVerificationToken, h.sha256(newRaw));
  assert.ok(doc.emailVerificationExpires.getTime() > Date.now() + 23.9 * 3600e3);

  const vOld = await request(app).post(`/engineering/verify-email/${oldRaw}`);
  assert.equal(vOld.status, 400);
  assert.equal(vOld.body.code, "TOKEN_INVALID");

  const vNew = await request(app).post(`/engineering/verify-email/${newRaw}`);
  assert.equal(vNew.status, 200);
  assert.equal(vNew.body.code, "EMAIL_VERIFIED");
});

test("resend within 60s cooldown -> 429 RESEND_COOLDOWN with retryAfterSeconds; token unchanged; no email", async () => {
  const body = h.signupBody();
  const s = await request(app).post("/engineering/usersignup").send(body);
  assert.equal(s.status, 201);
  const raw = h.extractToken(h.lastEmail(), "verify-email");
  const sentBefore = h.emailStub.sent.length;

  const r = await request(app).post("/engineering/resend-verification").send({ email: body.email });
  assert.equal(r.status, 429);
  assert.equal(r.body.success, false);
  assert.equal(r.body.code, "RESEND_COOLDOWN");
  assert.equal(typeof r.body.retryAfterSeconds, "number");
  assert.ok(r.body.retryAfterSeconds >= 1 && r.body.retryAfterSeconds <= 60, String(r.body.retryAfterSeconds));
  assert.equal(h.emailStub.sent.length, sentBefore);

  const doc = await h.getUserRaw({ email: body.email });
  assert.equal(doc.emailVerificationToken, h.sha256(raw), "token not replaced during cooldown");
});

test("resend for unknown email -> generic 200, no email sent", async () => {
  const r = await request(app).post("/engineering/resend-verification").send({ email: "ghost@example.com" });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.code, "VERIFICATION_RESENT");
  assert.equal(r.body.message, GENERIC);
  assert.equal(r.body.retryAfterSeconds, 60);
  assert.equal(h.emailStub.sent.length, 0);
});

test("resend for already-verified email -> generic 200, no email sent, account untouched", async () => {
  const { body, user } = await h.createUser({ verified: true });
  const r = await request(app).post("/engineering/resend-verification").send({ email: body.email });
  assert.equal(r.status, 200);
  assert.equal(r.body.code, "VERIFICATION_RESENT");
  assert.equal(r.body.message, GENERIC);
  assert.equal(h.emailStub.sent.length, 0);
  const doc = await h.getUserRaw({ _id: user._id });
  assert.equal(doc.isEmailVerified, true);
  assert.equal(doc.emailVerificationToken, undefined);
});

test("resend with invalid email -> 400", async () => {
  const r = await request(app).post("/engineering/resend-verification").send({ email: "not-an-email" });
  assert.equal(r.status, 400);
  assert.equal(r.body.success, false);
  assert.equal(h.emailStub.sent.length, 0);
});
