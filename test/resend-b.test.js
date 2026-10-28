// POST /resend-verification, part B (send failures). Keep resend requests <= 5.
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

async function seedUnverifiedWithToken() {
  const { user, body } = await h.createUser({ verified: false });
  const raw = h.randomToken();
  await h.User.collection.updateOne(
    { _id: user._id },
    {
      $set: {
        emailVerificationToken: h.sha256(raw),
        emailVerificationExpires: new Date(Date.now() + 24 * 3600e3),
        emailVerificationSentAt: new Date(Date.now() - 120_000),
      },
    }
  );
  return { user, body, raw };
}

test("resend send failure -> 503 EMAIL_SEND_FAILED, sentAt cleared so retry is allowed immediately", async () => {
  const { body, user } = await seedUnverifiedWithToken();
  h.emailStub.mode = "fail";
  const r = await request(app).post("/engineering/resend-verification").send({ email: body.email });
  assert.equal(r.status, 503);
  assert.equal(r.body.success, false);
  assert.equal(r.body.code, "EMAIL_SEND_FAILED");
  const doc = await h.getUserRaw({ _id: user._id });
  assert.ok(!doc.emailVerificationSentAt, "emailVerificationSentAt must be unset after failed send");

  h.emailStub.mode = "ok";
  const retry = await request(app).post("/engineering/resend-verification").send({ email: body.email });
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.code, "VERIFICATION_RESENT");
  assert.equal(h.emailStub.sent.length, 1);
});

test("resend send failure keeps the PREVIOUS verification link working", async () => {
  const { body, user, raw } = await seedUnverifiedWithToken();
  h.emailStub.mode = "fail";
  const r = await request(app).post("/engineering/resend-verification").send({ email: body.email });
  assert.equal(r.status, 503);

  const doc = await h.getUserRaw({ _id: user._id });
  assert.equal(doc.emailVerificationToken, h.sha256(raw), "old token hash must not be replaced on failed send");

  h.emailStub.mode = "ok";
  const v = await request(app).post(`/engineering/verify-email/${raw}`);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.code, "EMAIL_VERIFIED");
});

test("resend when email is not configured -> 503 EMAIL_SEND_FAILED, token untouched", async () => {
  const { body, user, raw } = await seedUnverifiedWithToken();
  h.emailStub.mode = "unconfigured";
  const r = await request(app).post("/engineering/resend-verification").send({ email: body.email });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "EMAIL_SEND_FAILED");
  assert.equal(h.emailStub.sent.length, 0);
  const doc = await h.getUserRaw({ _id: user._id });
  assert.equal(doc.emailVerificationToken, h.sha256(raw));
});
