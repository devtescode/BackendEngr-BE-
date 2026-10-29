// Profile picture upload: GET /engineering/profile, POST /engineering/profile-image,
// login + admin user listing exposure, and utils/uploadImage folder behaviour.
// Cloudinary is stubbed in test/helpers.js (config/cloudinary.js via require.cache);
// no real network calls are ever made.
//
// The profile-image limiter is per user (10 / 15 min). Each test creates fresh
// users after clearDb, so each test gets a fresh limiter bucket.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const h = require("./helpers");

const PROFILE_FOLDER = "euhardwarestore-profile-images";
const PRODUCT_FOLDER = "euhardwarestore-products";
const MB = 1024 * 1024;

const ioEvents = [];
const fakeIo = { emit: (event, payload) => ioEvents.push({ event, payload }) };

let app;
before(async () => {
  await h.startDb();
  app = h.buildApp({ admin: true, io: fakeIo, trustProxy: 1 });
});
after(h.stopDb);
beforeEach(async () => {
  await h.clearDb();
  ioEvents.length = 0;
});

let ipSeq = 0;
function freshIp() {
  ipSeq += 1;
  return `10.${Math.floor(ipSeq / 250) % 250}.${ipSeq % 250}.7`;
}

// Minimal "PNG": multer only sees the multipart Content-Type, but keep real magic bytes.
function pngBuffer(size = 128) {
  const b = Buffer.alloc(size, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  return b;
}

function upload(token, { buffer = pngBuffer(), filename = "me.png", contentType = "image/png", ip = freshIp(), field = "image" } = {}) {
  const r = request(app).post("/engineering/profile-image").set("X-Forwarded-For", ip);
  if (token) r.set("Authorization", `Bearer ${token}`);
  if (buffer === null) return r;
  return r.attach(field, buffer, { filename, contentType });
}

function getProfile(token) {
  const r = request(app).get("/engineering/profile");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}

async function rawUser(id) {
  return h.User.collection.findOne({ _id: id });
}

async function waitFor(cond, ms = 1500) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    await h.cloudinaryStub.settle();
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  await h.cloudinaryStub.settle();
  return cond();
}

// Give fire-and-forget work (e.g. old-asset cleanup) a chance to run before
// asserting that something did NOT happen.
async function quiesce() {
  await new Promise((r) => setTimeout(r, 100));
  await h.cloudinaryStub.settle();
}

function assertNoPublicIdLeak(res, publicIds = []) {
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes("profileImagePublicId"), `response leaks profileImagePublicId: ${text}`);
  // secure_url legitimately contains the public id (as real Cloudinary URLs
  // do), so look for the id as a standalone value, not a substring.
  const values = [];
  (function walk(v) {
    if (v && typeof v === "object") Object.values(v).forEach(walk);
    else values.push(v);
  })(res.body);
  for (const id of publicIds) {
    if (id) assert.ok(!values.includes(id), `response leaks public id ${id} as a value: ${text}`);
  }
}

// Replace User.findOneAndUpdate for exactly one call. `execImpl` decides what
// the query resolves/rejects with; the real query object is kept so chained
// .select()/.lean() etc. still work. findByIdAndUpdate delegates to
// findOneAndUpdate, so it is covered too.
function stubFindOneAndUpdateOnce(execImpl) {
  const User = h.User;
  const original = User.findOneAndUpdate;
  const state = { calls: 0 };
  User.findOneAndUpdate = function (...args) {
    User.findOneAndUpdate = original;
    state.calls += 1;
    const q = original.apply(this, args);
    q.exec = execImpl;
    return q;
  };
  state.restore = () => {
    User.findOneAndUpdate = original;
  };
  return state;
}

const USER_KEYS = ["id", "fullName", "email", "matric", "phoneNumber", "gender", "role", "profileImageUrl"];

// ---------------------------------------------------------------------------
// Upload: happy path
// ---------------------------------------------------------------------------

test("first upload: 200, saves URL + publicId, uses profile folder, no destroy, emits users:updated", async () => {
  const { user, body } = await h.createUser();
  const token = h.signJwtFor(user);

  const res = await upload(token);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.equal(typeof res.body.message, "string");

  const uploads = h.cloudinaryStub.uploads();
  assert.equal(uploads.length, 1);
  const up = uploads[0];
  assert.equal(up.options.folder, PROFILE_FOLDER);
  assert.equal(up.options.resource_type, "image");
  assert.deepEqual(up.options.transformation, [{ width: 512, height: 512, crop: "fill", gravity: "face" }]);
  assert.equal(up.size, 128, "the uploaded file buffer is what reaches Cloudinary");

  const { secure_url, public_id } = up.result;
  assert.equal(res.body.profileImageUrl, secure_url);
  assert.ok(res.body.user, "response.user present");
  for (const k of USER_KEYS) assert.ok(k in res.body.user, `user.${k} present`);
  assert.equal(res.body.user.id, String(user._id));
  assert.equal(res.body.user.email, body.email);
  assert.equal(res.body.user.fullName, body.fullName);
  assert.equal(res.body.user.matric, body.matric);
  assert.equal(res.body.user.phoneNumber, body.phoneNumber);
  assert.equal(res.body.user.gender, body.gender);
  assert.equal(res.body.user.role, "student");
  assert.equal(res.body.user.profileImageUrl, secure_url);
  assert.equal(res.body.user.password, undefined);
  assertNoPublicIdLeak(res, [public_id]);

  const saved = await h.User.findById(user._id).select("+profileImagePublicId");
  assert.equal(saved.profileImageUrl, secure_url);
  assert.equal(saved.profileImagePublicId, public_id);

  // Not selected by default.
  const plain = await h.User.findById(user._id);
  assert.equal(plain.profileImagePublicId, undefined);
  // toJSON strips it even when selected.
  assert.equal(saved.toJSON().profileImagePublicId, undefined);

  await quiesce();
  assert.equal(h.cloudinaryStub.destroys().length, 0, "nothing to delete on first upload");

  assert.equal(ioEvents.length, 1);
  assert.equal(ioEvents[0].event, "users:updated");
  assert.deepEqual(Object.keys(ioEvents[0].payload), ["userId"], "no PII in socket payload");
  assert.equal(String(ioEvents[0].payload.userId), String(user._id));
});

test("jpeg and webp are accepted", async () => {
  const { user } = await h.createUser();
  const token = h.signJwtFor(user);
  const r1 = await upload(token, { filename: "a.jpg", contentType: "image/jpeg" });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const r2 = await upload(token, { filename: "a.webp", contentType: "image/webp" });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
});

test("replace: old asset destroyed only after DB holds the new one", async () => {
  const { user } = await h.createUser();
  const token = h.signJwtFor(user);

  const first = await upload(token);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const oldId = h.cloudinaryStub.uploads()[0].result.public_id;
  await quiesce();

  h.cloudinaryStub.reset();
  // Snapshot DB state at the moment each Cloudinary call is made.
  h.cloudinaryStub.onUpload = async () => (await rawUser(user._id))?.profileImagePublicId;
  h.cloudinaryStub.onDestroy = async () => (await rawUser(user._id))?.profileImagePublicId;

  const second = await upload(token);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const up = h.cloudinaryStub.uploads()[0];
  const newId = up.result.public_id;
  assert.notEqual(newId, oldId);
  assert.equal(up.hook, oldId, "DB still had the old id while the new image was uploading");

  assert.ok(await waitFor(() => h.cloudinaryStub.destroys().length >= 1), "old asset destroyed");
  const destroys = h.cloudinaryStub.destroys();
  assert.equal(destroys.length, 1, "exactly one destroy");
  assert.equal(destroys[0].publicId, oldId, "destroy targets the OLD public id");
  assert.equal(destroys[0].hook, newId, "DB already held the new id when destroy was called");

  const types = h.cloudinaryStub.events.map((e) => e.type);
  assert.deepEqual(types, ["upload", "destroy"], "upload strictly before destroy");

  const saved = await h.User.findById(user._id).select("+profileImagePublicId");
  assert.equal(saved.profileImagePublicId, newId);
  assert.equal(saved.profileImageUrl, up.result.secure_url);
  assertNoPublicIdLeak(second, [oldId, newId]);
});

test("replace: destroy failure of the old asset does not fail the request", async () => {
  const { user } = await h.createUser();
  const token = h.signJwtFor(user);
  const first = await upload(token);
  assert.equal(first.status, 200);
  const oldId = h.cloudinaryStub.uploads()[0].result.public_id;
  await quiesce();

  h.cloudinaryStub.destroyMode = "fail";
  const second = await upload(token);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.success, true);
  const newUp = h.cloudinaryStub.uploads()[1];
  assert.equal(second.body.profileImageUrl, newUp.result.secure_url);

  assert.ok(await waitFor(() => h.cloudinaryStub.destroys().length >= 1), "destroy attempted");
  assert.equal(h.cloudinaryStub.destroys()[0].publicId, oldId);

  const saved = await h.User.findById(user._id).select("+profileImagePublicId");
  assert.equal(saved.profileImagePublicId, newUp.result.public_id);
  await quiesce(); // no unhandled rejection should surface from the failed destroy
});

// ---------------------------------------------------------------------------
// Upload: failure paths
// ---------------------------------------------------------------------------

test("DB write failure: new asset is destroyed, 5xx, old image kept", async () => {
  const { user } = await h.createUser();
  const token = h.signJwtFor(user);
  const first = await upload(token);
  assert.equal(first.status, 200);
  const oldUp = h.cloudinaryStub.uploads()[0].result;
  await quiesce();
  h.cloudinaryStub.reset();

  const stub = stubFindOneAndUpdateOnce(async () => {
    throw new Error("stubbed DB failure");
  });
  let res;
  try {
    res = await upload(token);
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls, 1, "controller used User.findOneAndUpdate / findByIdAndUpdate");
  assert.ok(res.status >= 500 && res.status < 600, `expected 5xx, got ${res.status} ${JSON.stringify(res.body)}`);
  assert.notEqual(res.body.success, true);

  const newId = h.cloudinaryStub.uploads()[0].result.public_id;
  assert.ok(await waitFor(() => h.cloudinaryStub.destroys().length >= 1), "new asset cleaned up");
  await quiesce();
  const destroyed = h.cloudinaryStub.destroys().map((d) => d.publicId);
  assert.deepEqual(destroyed, [newId], "only the NEW asset is destroyed; old one untouched");

  const saved = await h.User.findById(user._id).select("+profileImagePublicId");
  assert.equal(saved.profileImagePublicId, oldUp.public_id);
  assert.equal(saved.profileImageUrl, oldUp.secure_url);
  assert.equal(ioEvents.filter((e) => e.event === "users:updated").length, 1, "no emit for failed upload");
});

test("user missing at save time: 404 and the new asset is destroyed", async () => {
  const { user } = await h.createUser();
  const token = h.signJwtFor(user);

  const stub = stubFindOneAndUpdateOnce(async () => null);
  let res;
  try {
    res = await upload(token);
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls, 1);
  assert.equal(res.status, 404, JSON.stringify(res.body));
  const newId = h.cloudinaryStub.uploads()[0].result.public_id;
  assert.ok(await waitFor(() => h.cloudinaryStub.destroys().length >= 1), "new asset cleaned up");
  assert.deepEqual(h.cloudinaryStub.destroys().map((d) => d.publicId), [newId]);
  assert.equal(ioEvents.length, 0);
});

test("Cloudinary upload failure: 5xx, DB unchanged, nothing destroyed", async () => {
  const { user } = await h.createUser();
  const token = h.signJwtFor(user);
  const first = await upload(token);
  assert.equal(first.status, 200);
  const oldUp = h.cloudinaryStub.uploads()[0].result;
  await quiesce();
  h.cloudinaryStub.reset();
  ioEvents.length = 0;

  h.cloudinaryStub.uploadMode = "fail";
  const res = await upload(token);
  assert.ok(res.status >= 500 && res.status < 600, `expected 5xx, got ${res.status} ${JSON.stringify(res.body)}`);
  assert.notEqual(res.body.success, true);
  assert.equal(h.cloudinaryStub.uploads().length, 1);

  await quiesce();
  assert.equal(h.cloudinaryStub.destroys().length, 0);
  const saved = await h.User.findById(user._id).select("+profileImagePublicId");
  assert.equal(saved.profileImagePublicId, oldUp.public_id);
  assert.equal(saved.profileImageUrl, oldUp.secure_url);
  assert.equal(ioEvents.length, 0);
});

test("Cloudinary upload failure on first upload leaves no image fields", async () => {
  const { user } = await h.createUser();
  h.cloudinaryStub.uploadMode = "fail";
  const res = await upload(h.signJwtFor(user));
  assert.ok(res.status >= 500 && res.status < 600, `got ${res.status}`);
  const doc = await rawUser(user._id);
  assert.equal(doc.profileImageUrl, undefined);
  assert.equal(doc.profileImagePublicId, undefined);
});

// ---------------------------------------------------------------------------
// Upload: validation
// ---------------------------------------------------------------------------

for (const [contentType, filename] of [
  ["image/gif", "a.gif"],
  ["text/plain", "a.txt"],
  ["application/pdf", "a.pdf"],
  ["image/svg+xml", "a.svg"],
]) {
  test(`wrong type ${contentType} -> 400 INVALID_IMAGE, no Cloudinary call`, async () => {
    const { user } = await h.createUser();
    const res = await upload(h.signJwtFor(user), { contentType, filename });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, "INVALID_IMAGE");
    assert.equal(h.cloudinaryStub.events.length, 0);
    const doc = await rawUser(user._id);
    assert.equal(doc.profileImageUrl, undefined);
  });
}

test("file over 5MB -> 400 IMAGE_TOO_LARGE, no Cloudinary call", async () => {
  const { user } = await h.createUser();
  const res = await upload(h.signJwtFor(user), { buffer: pngBuffer(5 * MB + 1) });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "IMAGE_TOO_LARGE");
  assert.equal(h.cloudinaryStub.events.length, 0);
});

test("file of exactly 5MB is accepted", async () => {
  const { user } = await h.createUser();
  const res = await upload(h.signJwtFor(user), { buffer: pngBuffer(5 * MB) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test("no file -> 400 INVALID_IMAGE, no Cloudinary call", async () => {
  const { user } = await h.createUser();
  const token = h.signJwtFor(user);

  const empty = await upload(token, { buffer: null }).field("note", "no file here");
  assert.equal(empty.status, 400, JSON.stringify(empty.body));
  assert.equal(empty.body.code, "INVALID_IMAGE");

  const noBody = await upload(token, { buffer: null });
  assert.equal(noBody.status, 400, JSON.stringify(noBody.body));
  assert.equal(noBody.body.code, "INVALID_IMAGE");

  assert.equal(h.cloudinaryStub.events.length, 0);
});

test("file under the wrong field name -> 400, no Cloudinary call", async () => {
  const { user } = await h.createUser();
  const res = await upload(h.signJwtFor(user), { field: "avatar" });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(h.cloudinaryStub.events.length, 0);
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

test("no token -> 401 on upload and profile; bad token -> 401", async () => {
  const up = await upload(null);
  assert.equal(up.status, 401);
  const prof = await getProfile(null);
  assert.equal(prof.status, 401);
  const bad = await upload("not-a-jwt");
  assert.equal(bad.status, 401);
  assert.equal(h.cloudinaryStub.events.length, 0);
});

test("unverified user's token -> 403 EMAIL_NOT_VERIFIED on upload and profile", async () => {
  const { user } = await h.createUser({ verified: false });
  const token = h.signJwtFor(user);
  const up = await upload(token);
  assert.equal(up.status, 403);
  assert.equal(up.body.code, "EMAIL_NOT_VERIFIED");
  const prof = await getProfile(token);
  assert.equal(prof.status, 403);
  assert.equal(prof.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(h.cloudinaryStub.events.length, 0);
  assert.equal((await rawUser(user._id)).profileImageUrl, undefined);
});

// ---------------------------------------------------------------------------
// GET /profile, login, admin listing
// ---------------------------------------------------------------------------

test("GET /profile returns profile fields + profileImageUrl, never profileImagePublicId", async () => {
  const { user, body } = await h.createUser();
  const token = h.signJwtFor(user);

  const before = await getProfile(token);
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.equal(before.body.success, true);
  assert.equal(before.body.user.id, String(user._id));
  assert.equal(before.body.user.email, body.email);
  assert.equal(before.body.user.fullName, body.fullName);
  assert.equal(before.body.user.matric, body.matric);
  assert.equal(before.body.user.phoneNumber, body.phoneNumber);
  assert.equal(before.body.user.gender, body.gender);
  assert.equal(before.body.user.role, "student");
  assert.ok(!before.body.user.profileImageUrl, "no image yet");
  assert.equal(before.body.user.password, undefined);

  const up = await upload(token);
  assert.equal(up.status, 200);
  const { secure_url, public_id } = h.cloudinaryStub.uploads()[0].result;

  const after = await getProfile(token);
  assert.equal(after.status, 200);
  assert.equal(after.body.user.profileImageUrl, secure_url);
  for (const k of USER_KEYS) assert.ok(k in after.body.user, `user.${k} present`);
  assert.equal(after.body.user.password, undefined);
  assertNoPublicIdLeak(after, [public_id]);
});

test("login response user includes profileImageUrl (survives logout/login)", async () => {
  const { user, body, password } = await h.createUser();
  const up = await upload(h.signJwtFor(user));
  assert.equal(up.status, 200);
  const { secure_url, public_id } = h.cloudinaryStub.uploads()[0].result;

  const login = await request(app).post("/engineering/userlogin").send({ email: body.email, password });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.user.profileImageUrl, secure_url);
  assertNoPublicIdLeak(login, [public_id]);

  // Fresh token from login still sees the image.
  const prof = await getProfile(login.body.token);
  assert.equal(prof.status, 200);
  assert.equal(prof.body.user.profileImageUrl, secure_url);
});

test("admin GET /admin/getallusers includes profileImageUrl, never profileImagePublicId", async () => {
  const { user } = await h.createUser();
  const { user: other } = await h.createUser();
  const up = await upload(h.signJwtFor(user));
  assert.equal(up.status, 200);
  const { secure_url, public_id } = h.cloudinaryStub.uploads()[0].result;

  const noAuth = await request(app).get("/admin/getallusers");
  assert.equal(noAuth.status, 401);
  const studentToken = await request(app).get("/admin/getallusers").set("Authorization", `Bearer ${h.signJwtFor(user)}`);
  assert.equal(studentToken.status, 401, "student JWT is not an admin JWT");

  const res = await request(app).get("/admin/getallusers").set("Authorization", `Bearer ${h.signAdminJwt()}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const users = res.body.users;
  assert.ok(Array.isArray(users));
  const withImg = users.find((u) => String(u._id) === String(user._id));
  const without = users.find((u) => String(u._id) === String(other._id));
  assert.ok(withImg && without);
  assert.equal(withImg.profileImageUrl, secure_url);
  assert.ok(!without.profileImageUrl);
  assertNoPublicIdLeak(res, [public_id]);
});

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

test("profile-image limiter: 10 uploads per user allowed, 11th -> 429; another user on the same IP is unaffected", async () => {
  const { user } = await h.createUser();
  const token = h.signJwtFor(user);
  const ip = freshIp();
  for (let i = 1; i <= 10; i++) {
    const r = await upload(token, { ip });
    assert.equal(r.status, 200, `request ${i}: ${JSON.stringify(r.body)}`);
  }
  const r11 = await upload(token, { ip });
  assert.equal(r11.status, 429);
  assert.equal(r11.body.code, "RATE_LIMITED");
  assert.equal(h.cloudinaryStub.uploads().length, 10, "limited request never reaches Cloudinary");

  // Changing IP doesn't reset the same user's allowance.
  const sameUserOtherIp = await upload(token, { ip: freshIp() });
  assert.equal(sameUserOtherIp.status, 429);

  // A different student behind the same campus NAT still can upload.
  const { user: other } = await h.createUser({
    email: "other.student@example.com",
    matric: "EU250102-9999",
    phoneNumber: "08099999999",
  });
  const otherRes = await upload(h.signJwtFor(other), { ip });
  assert.equal(otherRes.status, 200, JSON.stringify(otherRes.body));
});

test("spoofed mimetype: SVG/HTML bytes sent as image/png -> 400 INVALID_IMAGE, never reaches Cloudinary", async () => {
  const { user } = await h.createUser();
  const token = h.signJwtFor(user);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const r = await upload(token, { buffer: svg, filename: "x.png", contentType: "image/png" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "INVALID_IMAGE");
  assert.equal(h.cloudinaryStub.uploads().length, 0);
});

test("extra multipart text fields are rejected (no unbounded buffering)", async () => {
  const { user } = await h.createUser();
  const token = h.signJwtFor(user);
  const r = await upload(token).field("junk", "x".repeat(2000));
  assert.equal(r.status, 400);
  assert.equal(h.cloudinaryStub.uploads().length, 0);
});

test("profile upload restricts and re-encodes formats on Cloudinary", async () => {
  const { user } = await h.createUser();
  const r = await upload(h.signJwtFor(user));
  assert.equal(r.status, 200);
  const opts = h.cloudinaryStub.uploads()[0].options;
  assert.deepEqual(opts.allowed_formats, ["jpg", "jpeg", "png", "webp"]);
  assert.equal(opts.format, "webp");
});

// ---------------------------------------------------------------------------
// utils/uploadImage.js
// ---------------------------------------------------------------------------

test("product uploadImage(buffer) with no options still uses only the products folder", async () => {
  const uploadImage = require("../utils/uploadImage");
  const result = await uploadImage(Buffer.from("product-bytes"));
  const ups = h.cloudinaryStub.uploads();
  assert.equal(ups.length, 1);
  assert.deepEqual(ups[0].options, { folder: PRODUCT_FOLDER }, "product upload options unchanged");
  assert.equal(result.secure_url, ups[0].result.secure_url);
  assert.equal(result.public_id, ups[0].result.public_id);
});

test("uploadImage(buffer, options) merges options over the products default", async () => {
  const uploadImage = require("../utils/uploadImage");
  await uploadImage(Buffer.from("x"), { folder: PROFILE_FOLDER, resource_type: "image" });
  const ups = h.cloudinaryStub.uploads();
  assert.equal(ups[0].options.folder, PROFILE_FOLDER);
  assert.equal(ups[0].options.resource_type, "image");
});

test("uploadImage rejects when Cloudinary fails", async () => {
  const uploadImage = require("../utils/uploadImage");
  h.cloudinaryStub.uploadMode = "fail";
  await assert.rejects(uploadImage(Buffer.from("x")));
});

test("uploadImage.deleteImage(publicId) calls destroy(publicId, { invalidate: true })", async () => {
  const uploadImage = require("../utils/uploadImage");
  assert.equal(typeof uploadImage.deleteImage, "function");
  await uploadImage.deleteImage("some/folder/id");
  const d = h.cloudinaryStub.destroys();
  assert.equal(d.length, 1);
  assert.equal(d[0].publicId, "some/folder/id");
  assert.deepEqual(d[0].opts, { invalidate: true });
});
