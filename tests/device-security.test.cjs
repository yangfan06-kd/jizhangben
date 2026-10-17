const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const { createRuntime } = require("./runtime.cjs");

test("local six-digit passwords and recovery answers use salted digests", async () => {
  const runtime = createRuntime({}, { window: { crypto: webcrypto, TextEncoder } });
  const salt = "00112233445566778899aabbccddeeff";
  const pinDigest = await runtime.run(`deviceDigest("123456", "${salt}")`);
  const answerDigest = await runtime.run(`deviceDigest("school name", "${salt}")`);
  assert.equal(pinDigest.length, 64);
  assert.notEqual(pinDigest, "123456");
  assert.equal(runtime.run(`sameDeviceDigest("${pinDigest}", "${pinDigest}")`), true);
  assert.equal(runtime.run(`sameDeviceDigest("${pinDigest}", "${answerDigest}")`), false);
});

test("local privacy and app-lock settings stay outside ledger backups", () => {
  const runtime = createRuntime({
    ledger_device_lock_v1: JSON.stringify({ version: 1, pin: { salt: "salt", hash: "digest" }, questions: [] }),
    ledger_privacy_mask_v1: "1",
    jizhangben_books: JSON.stringify([{ id: 1, name: "个人账本", category: "个人" }])
  });
  const backedUpKeys = JSON.parse(JSON.stringify(runtime.run("appStorage.entries('jizhangben_')")));
  assert.deepEqual(Object.keys(backedUpKeys), ["jizhangben_books"]);
  assert.equal(Object.hasOwn(backedUpKeys, "ledger_device_lock_v1"), false);
  assert.equal(Object.hasOwn(backedUpKeys, "ledger_privacy_mask_v1"), false);
});
