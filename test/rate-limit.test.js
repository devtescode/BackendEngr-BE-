// Rate limiter tests. Each limiter is an in-memory per-process store, and
// node --test runs each file in its own process, so these counts start at 0.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const h = require("./helpers");

let app;
before(async () => {
  await h.startDb();
  app = h.buildApp();
});
after(h.stopDb);

test("resend-verification: 5 requests allowed, 6th -> 429 RATE_LIMITED", async () => {
  for (let i = 1; i <= 5; i++) {
    const r = await request(app).post("/engineering/resend-verification").send({ email: `ghost${i}@example.com` });
    assert.equal(r.status, 200, `request ${i}: ${JSON.stringify(r.body)}`);
  }
  const r6 = await request(app).post("/engineering/resend-verification").send({ email: "ghost6@example.com" });
  assert.equal(r6.status, 429);
  assert.equal(r6.body.success, false);
  assert.equal(r6.body.code, "RATE_LIMITED");
  assert.equal(h.emailStub.sent.length, 0);
});

test("forgot-password: 5 requests allowed, 6th -> 429", async () => {
  for (let i = 1; i <= 5; i++) {
    const r = await request(app).post("/engineering/forgot-password").send({ email: `nobody${i}@example.com` });
    assert.equal(r.status, 404, `request ${i}`);
  }
  const r6 = await request(app).post("/engineering/forgot-password").send({ email: "nobody6@example.com" });
  assert.equal(r6.status, 429);
  assert.equal(r6.body.success, false);
});

test("verify-email: 20 requests allowed, 21st -> 429 RATE_LIMITED", async () => {
  for (let i = 1; i <= 20; i++) {
    const r = await request(app).post(`/engineering/verify-email/${h.randomToken()}`);
    assert.equal(r.status, 400, `request ${i}`);
  }
  const r21 = await request(app).post(`/engineering/verify-email/${h.randomToken()}`);
  assert.equal(r21.status, 429);
  assert.equal(r21.body.code, "RATE_LIMITED");
});

test("usersignup: 10 requests allowed, 11th -> 429 RATE_LIMITED", async () => {
  for (let i = 1; i <= 10; i++) {
    const r = await request(app).post("/engineering/usersignup").send(h.signupBody());
    assert.equal(r.status, 201, `request ${i}: ${JSON.stringify(r.body)}`);
  }
  const r11 = await request(app).post("/engineering/usersignup").send(h.signupBody());
  assert.equal(r11.status, 429);
  assert.equal(r11.body.code, "RATE_LIMITED");
});
