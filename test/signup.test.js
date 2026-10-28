// Signup + login behaviour. Keep signups <= 10 (signupLimiter) and
// resend requests <= 5 (resendVerificationLimiter) in this file.
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

test("signup creates an unverified user, stores only the token hash and sends a verification email (201 VERIFICATION_SENT)", async () => {
  const body = h.signupBody();
  const res = await request(app).post("/engineering/usersignup").send(body);

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.code, "VERIFICATION_SENT");
  assert.equal(res.body.email, body.email);
  assert.equal(typeof res.body.message, "string");
  assert.equal(res.body.user, undefined, "must not return the user document");
  assert.equal(res.body.token, undefined, "must not return a JWT");

  assert.equal(h.emailStub.sent.length, 1);
  const msg = h.lastEmail();
  assert.equal(msg.to, body.email);
  assert.equal(msg.subject, "Verify your EU Hardwarestore email");
  const raw = h.extractToken(msg, "verify-email");
  assert.ok(raw, "email text must contain FRONTEND_URL/verify-email/<64hex>");

  const doc = await h.getUserRaw({ email: body.email });
  assert.ok(doc);
  assert.equal(doc.isEmailVerified, false);
  assert.equal(doc.emailVerificationToken, h.sha256(raw), "stores sha256 of raw token");
  assert.notEqual(doc.emailVerificationToken, raw);
  assert.ok(doc.emailVerificationExpires instanceof Date);
  const ttl = doc.emailVerificationExpires.getTime() - Date.now();
  assert.ok(ttl > 23.9 * 3600e3 && ttl <= 24 * 3600e3 + 5000, `TTL ~24h, got ${ttl}ms`);
  assert.ok(doc.emailVerificationSentAt instanceof Date, "sentAt set after successful send");
  assert.notEqual(doc.password, body.password, "password is hashed");
});

test("toJSON strips verification fields", async () => {
  const { user } = await h.createUser({ verified: false });
  await h.User.updateOne(
    { _id: user._id },
    { $set: { emailVerificationToken: "x", emailVerificationExpires: new Date(), emailVerificationSentAt: new Date() } }
  );
  const loaded = await h.User.findById(user._id).select(
    "+emailVerificationToken +emailVerificationExpires +emailVerificationSentAt"
  );
  assert.equal(loaded.emailVerificationToken, "x");
  const json = loaded.toJSON();
  assert.equal(json.emailVerificationToken, undefined);
  assert.equal(json.emailVerificationExpires, undefined);
  assert.equal(json.emailVerificationSentAt, undefined);
  assert.equal(json.password, undefined);
});

test("email send failure -> 201 VERIFICATION_EMAIL_FAILED, account kept, resend immediately works", async () => {
  const body = h.signupBody();
  h.emailStub.mode = "fail";
  const res = await request(app).post("/engineering/usersignup").send(body);

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.code, "VERIFICATION_EMAIL_FAILED");
  assert.equal(res.body.email, body.email);
  assert.equal(res.body.token, undefined);

  const doc = await h.getUserRaw({ email: body.email });
  assert.ok(doc, "account is kept");
  assert.equal(doc.isEmailVerified, false);
  assert.ok(!doc.emailVerificationSentAt, "sentAt must not be set when send failed");

  h.emailStub.mode = "ok";
  const resend = await request(app).post("/engineering/resend-verification").send({ email: body.email });
  assert.equal(resend.status, 200, JSON.stringify(resend.body));
  assert.equal(resend.body.code, "VERIFICATION_RESENT");
  assert.equal(h.emailStub.sent.length, 1);
  const raw = h.extractToken(h.lastEmail(), "verify-email");
  assert.ok(raw);

  const verify = await request(app).post(`/engineering/verify-email/${raw}`);
  assert.equal(verify.status, 200);
  assert.equal(verify.body.code, "EMAIL_VERIFIED");
});

test("email not configured -> 201 VERIFICATION_EMAIL_FAILED and account kept", async () => {
  const body = h.signupBody();
  h.emailStub.mode = "unconfigured";
  const res = await request(app).post("/engineering/usersignup").send(body);

  assert.equal(res.status, 201);
  assert.equal(res.body.code, "VERIFICATION_EMAIL_FAILED");
  assert.equal(h.emailStub.sent.length, 0);
  const doc = await h.getUserRaw({ email: body.email });
  assert.ok(doc);
  assert.equal(doc.isEmailVerified, false);
});

test("duplicate signup of an unverified email -> 409 EMAIL_NOT_VERIFIED; password/profile unchanged; no second doc", async () => {
  const first = h.signupBody({ fullName: "Original Name" });
  const r1 = await request(app).post("/engineering/usersignup").send(first);
  assert.equal(r1.status, 201);
  const before = await h.getUserRaw({ email: first.email });

  const second = h.signupBody({
    email: first.email,
    fullName: "Attacker Name",
    password: "DifferentPass999!",
    gender: "Female",
  });
  const r2 = await request(app).post("/engineering/usersignup").send(second);

  assert.equal(r2.status, 409);
  assert.equal(r2.body.success, false);
  assert.equal(r2.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(r2.body.email, first.email);
  assert.equal(r2.body.token, undefined);

  const count = await h.User.countDocuments({});
  assert.equal(count, 1, "no second document");
  const afterDoc = await h.getUserRaw({ email: first.email });
  assert.equal(afterDoc.password, before.password, "password hash unchanged");
  assert.equal(afterDoc.fullName, "Original Name");
  assert.equal(afterDoc.gender, first.gender);
  assert.equal(afterDoc.matric, first.matric);
  assert.equal(afterDoc.phoneNumber, first.phoneNumber);

  // Original password still logs in far enough to hit the verification gate.
  const login = await request(app).post("/engineering/userlogin").send({ email: first.email, password: first.password });
  assert.equal(login.status, 403);
  const loginNew = await request(app).post("/engineering/userlogin").send({ email: first.email, password: second.password });
  assert.equal(loginNew.status, 401, "attacker password must not work");
});

test("duplicate signup of a verified email -> 409 ACCOUNT_EXISTS", async () => {
  const { body } = await h.createUser({ verified: true });
  const res = await request(app)
    .post("/engineering/usersignup")
    .send(h.signupBody({ email: body.email }));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "ACCOUNT_EXISTS");
  assert.equal(await h.User.countDocuments({}), 1);
  assert.equal(h.emailStub.sent.length, 0);
});

test("matric already taken by another account -> 409 ACCOUNT_EXISTS", async () => {
  const { body } = await h.createUser({ verified: false });
  const res = await request(app)
    .post("/engineering/usersignup")
    .send(h.signupBody({ matric: body.matric }));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "ACCOUNT_EXISTS");
  assert.equal(await h.User.countDocuments({}), 1);
});

test("email is trimmed + lowercased on signup; mixed-case duplicate detected", async () => {
  const n = Date.now();
  const messy = `  MiXeD.${n}@Example.COM  `;
  const normalised = `mixed.${n}@example.com`;
  const r1 = await request(app).post("/engineering/usersignup").send(h.signupBody({ email: messy }));
  assert.equal(r1.status, 201);
  assert.equal(r1.body.email, normalised);
  assert.equal(h.lastEmail().to, normalised);
  const doc = await h.getUserRaw({ email: normalised });
  assert.ok(doc, "stored normalised");

  const r2 = await request(app)
    .post("/engineering/usersignup")
    .send(h.signupBody({ email: `MIXED.${n}@EXAMPLE.com` }));
  assert.equal(r2.status, 409);
  assert.equal(r2.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(await h.User.countDocuments({}), 1);
});

test("unverified user login -> 403 EMAIL_NOT_VERIFIED with no token", async () => {
  const { body, password } = await h.createUser({ verified: false });
  const res = await request(app)
    .post("/engineering/userlogin")
    .send({ email: ` ${body.email.toUpperCase()} `, password });
  assert.equal(res.status, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(res.body.email, body.email);
  assert.equal(res.body.token, undefined);
});

test("legacy user (isEmailVerified field missing) is treated as unverified at login", async () => {
  const { body, password } = await h.createLegacyUser();
  const res = await request(app).post("/engineering/userlogin").send({ email: body.email, password });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(res.body.token, undefined);
});

test("login keeps 404 for unknown email and 401 for wrong password (even when unverified)", async () => {
  const r404 = await request(app).post("/engineering/userlogin").send({ email: "nobody@example.com", password: "whatever123" });
  assert.equal(r404.status, 404);
  const { body } = await h.createUser({ verified: false });
  const r401 = await request(app).post("/engineering/userlogin").send({ email: body.email, password: "wrongpass123" });
  assert.equal(r401.status, 401);
  assert.equal(r401.body.token, undefined);
});

test("verified user logs in -> 200 with token and user", async () => {
  const { body, password } = await h.createUser({ verified: true });
  const res = await request(app).post("/engineering/userlogin").send({ email: body.email, password });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.token, "string");
  assert.equal(res.body.user.email, body.email);
});
