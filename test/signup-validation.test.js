// Signup input validation + abandoned-signup cleanup. Keep signups <= 10.
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

const EIGHT_DAYS = 8 * 24 * 3600e3;

async function ageDoc(id, ms) {
  await h.User.collection.updateOne({ _id: id }, { $set: { createdAt: new Date(Date.now() - ms) } });
}

test("signup with a missing field -> 400 'All fields are required', nothing created", async () => {
  const body = h.signupBody();
  delete body.phoneNumber;
  const r = await request(app).post("/engineering/usersignup").send(body);
  assert.equal(r.status, 400);
  assert.equal(r.body.success, false);
  assert.equal(r.body.message, "All fields are required");
  assert.equal(await h.User.countDocuments({}), 0);
  assert.equal(h.emailStub.sent.length, 0);
});

test("signup with an operator object as matric -> 400, no NoSQL injection lookup", async () => {
  await h.createUser({ verified: true, matric: "EU12345" });
  const r = await request(app)
    .post("/engineering/usersignup")
    .send(h.signupBody({ matric: { $regex: "^EU" } }));
  assert.equal(r.status, 400);
  assert.equal(r.body.message, "All fields are required");
  assert.equal(await h.User.countDocuments({}), 1);
});

test("signup with non-string password -> 400", async () => {
  const r = await request(app)
    .post("/engineering/usersignup")
    .send(h.signupBody({ password: 12345678 }));
  assert.equal(r.status, 400);
  assert.equal(r.body.message, "All fields are required");
  assert.equal(await h.User.countDocuments({}), 0);
});

test("login with non-string password -> 400 and no token", async () => {
  const { body } = await h.createUser({ verified: true });
  const r = await request(app)
    .post("/engineering/userlogin")
    .send({ email: body.email, password: { $ne: null } });
  assert.equal(r.status, 400);
  assert.equal(r.body.token, undefined);
});

test("abandoned unverified signup (>7 days, has token) is replaced by a new signup with same email (201)", async () => {
  const { user, body } = await h.createUser({ verified: false });
  await h.User.collection.updateOne({ _id: user._id }, { $set: { emailVerificationToken: h.sha256(h.randomToken()) } });
  await ageDoc(user._id, EIGHT_DAYS);

  const fresh = h.signupBody({ email: body.email, fullName: "New Owner" });
  const r = await request(app).post("/engineering/usersignup").send(fresh);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.code, "VERIFICATION_SENT");
  assert.equal(await h.User.countDocuments({}), 1);
  assert.equal(await h.User.countDocuments({ _id: user._id }), 0, "old doc deleted");
  const doc = await h.getUserRaw({ email: body.email });
  assert.equal(doc.fullName, "New Owner");
  assert.equal(doc.isEmailVerified, false);
});

test("abandoned unverified signup is cleared when a new signup reuses its matric / phone", async () => {
  const a = await h.createUser({ verified: false });
  await h.User.collection.updateOne({ _id: a.user._id }, { $set: { emailVerificationToken: h.sha256(h.randomToken()) } });
  await ageDoc(a.user._id, EIGHT_DAYS);
  const r1 = await request(app).post("/engineering/usersignup").send(h.signupBody({ matric: a.body.matric }));
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(await h.User.countDocuments({ _id: a.user._id }), 0);

  const b = await h.createUser({ verified: false });
  await h.User.collection.updateOne({ _id: b.user._id }, { $set: { emailVerificationToken: h.sha256(h.randomToken()) } });
  await ageDoc(b.user._id, EIGHT_DAYS);
  const r2 = await request(app).post("/engineering/usersignup").send(h.signupBody({ phoneNumber: b.body.phoneNumber }));
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal(await h.User.countDocuments({ _id: b.user._id }), 0);
});

test("recent unverified signup (<7 days) is NOT deleted -> 409 EMAIL_NOT_VERIFIED", async () => {
  const { user, body } = await h.createUser({ verified: false });
  await h.User.collection.updateOne({ _id: user._id }, { $set: { emailVerificationToken: h.sha256(h.randomToken()) } });
  await ageDoc(user._id, 6 * 24 * 3600e3);
  const r = await request(app).post("/engineering/usersignup").send(h.signupBody({ email: body.email }));
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(await h.User.countDocuments({ _id: user._id }), 1);
});

test("old legacy doc (no isEmailVerified, no token) is never deleted by a new signup", async () => {
  const { id, body } = await h.createLegacyUser();
  await ageDoc(id, 400 * 24 * 3600e3);
  const r = await request(app).post("/engineering/usersignup").send(h.signupBody({ email: body.email }));
  assert.equal(r.status, 409);
  assert.equal(await h.User.countDocuments({ _id: id }), 1, "legacy doc kept");
  assert.equal(await h.User.countDocuments({}), 1);
});

test("old verified account is never deleted -> 409 ACCOUNT_EXISTS", async () => {
  const { user, body } = await h.createUser({ verified: true });
  await ageDoc(user._id, 400 * 24 * 3600e3);
  const r = await request(app).post("/engineering/usersignup").send(h.signupBody({ email: body.email }));
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "ACCOUNT_EXISTS");
  assert.equal(await h.User.countDocuments({ _id: user._id }), 1);
});

// ---------------------------------------------------------------------------
// Field-specific ACCOUNT_EXISTS conflicts + server-side matric/phone
// normalization. These use their own app with trust proxy so each signup
// comes from a fresh IP and stays clear of the per-IP signup limiter.
// ---------------------------------------------------------------------------
const MATRIC_TAKEN = "This matric number is already registered to another account.";
const PHONE_TAKEN = "This phone number is already registered to another account.";

let proxiedApp;
let ipSeq = 0;
function signupFromFreshIp(body) {
  if (!proxiedApp) proxiedApp = h.buildApp({ trustProxy: 1 });
  ipSeq += 1;
  return request(proxiedApp)
    .post("/engineering/usersignup")
    .set("X-Forwarded-For", `10.77.${ipSeq % 250}.${(ipSeq * 7) % 250}`)
    .send(body);
}

test("signup reusing another account's matric -> 409 ACCOUNT_EXISTS field 'matric' with specific message", async () => {
  const existing = await h.createUser({ verified: true });
  const r = await signupFromFreshIp(h.signupBody({ matric: existing.body.matric }));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.success, false);
  assert.equal(r.body.code, "ACCOUNT_EXISTS");
  assert.equal(r.body.field, "matric");
  assert.equal(r.body.message, MATRIC_TAKEN);
  assert.equal(await h.User.countDocuments({}), 1);
  assert.equal(h.emailStub.sent.length, 0);
});

test("signup reusing another account's phone -> 409 ACCOUNT_EXISTS field 'phoneNumber' with specific message", async () => {
  const existing = await h.createUser({ verified: true });
  const r = await signupFromFreshIp(h.signupBody({ phoneNumber: existing.body.phoneNumber }));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.success, false);
  assert.equal(r.body.code, "ACCOUNT_EXISTS");
  assert.equal(r.body.field, "phoneNumber");
  assert.equal(r.body.message, PHONE_TAKEN);
  assert.equal(await h.User.countDocuments({}), 1);
  assert.equal(h.emailStub.sent.length, 0);
});

test("matric differing only by case/whitespace is still detected as a duplicate", async () => {
  await h.createUser({ verified: true, matric: "EU250102-1234" });
  const r = await signupFromFreshIp(h.signupBody({ matric: " eu250102-1234 " }));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "ACCOUNT_EXISTS");
  assert.equal(r.body.field, "matric");
  assert.equal(r.body.message, MATRIC_TAKEN);
  assert.equal(await h.User.countDocuments({}), 1);
});

test("phone with surrounding whitespace is still detected as a duplicate", async () => {
  await h.createUser({ verified: true, phoneNumber: "08031234567" });
  const r = await signupFromFreshIp(h.signupBody({ phoneNumber: "  08031234567 " }));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "ACCOUNT_EXISTS");
  assert.equal(r.body.field, "phoneNumber");
  assert.equal(r.body.message, PHONE_TAKEN);
  assert.equal(await h.User.countDocuments({}), 1);
});

test("new account stores matric uppercased+trimmed and phone trimmed", async () => {
  const body = h.signupBody({ matric: " eu250199-9999 ", phoneNumber: " 08039998877  " });
  const r = await signupFromFreshIp(body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const doc = await h.getUserRaw({ email: body.email.toLowerCase() });
  assert.ok(doc, "user created");
  assert.equal(doc.matric, "EU250199-9999");
  assert.equal(doc.phoneNumber, "08039998877");

  // ...so a later signup with the canonical form collides with it.
  const again = await signupFromFreshIp(h.signupBody({ matric: "EU250199-9999" }));
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.equal(again.body.field, "matric");
  const againPhone = await signupFromFreshIp(h.signupBody({ phoneNumber: "08039998877" }));
  assert.equal(againPhone.status, 409, JSON.stringify(againPhone.body));
  assert.equal(againPhone.body.field, "phoneNumber");
  assert.equal(await h.User.countDocuments({}), 1);
});

test("email conflicts are unchanged (and take precedence over matric/phone conflicts)", async () => {
  const verified = await h.createUser({ verified: true });
  const r1 = await signupFromFreshIp(
    h.signupBody({ email: verified.body.email, matric: verified.body.matric, phoneNumber: verified.body.phoneNumber })
  );
  assert.equal(r1.status, 409, JSON.stringify(r1.body));
  assert.equal(r1.body.code, "ACCOUNT_EXISTS");
  assert.equal(r1.body.message, "An account with this email already exists. Please log in.");
  assert.notEqual(r1.body.field, "matric");
  assert.notEqual(r1.body.field, "phoneNumber");

  const unverified = await h.createUser({ verified: false });
  const r2 = await signupFromFreshIp(h.signupBody({ email: unverified.body.email, matric: unverified.body.matric }));
  assert.equal(r2.status, 409, JSON.stringify(r2.body));
  assert.equal(r2.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(r2.body.email, unverified.body.email.toLowerCase());
  assert.equal(await h.User.countDocuments({}), 2);
});
