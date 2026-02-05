const test = require("node:test");
const assert = require("node:assert/strict");

test("dist ESM + CJS entrypoints load and work", async () => {
  const esm = await import("../dist/esm/index.js");
  const cjs = require("../dist/cjs/index.js");

  assert.equal(typeof esm.diff, "function");
  assert.equal(typeof esm.apply, "function");
  assert.equal(typeof esm.TreeDiffError, "function");

  assert.equal(typeof cjs.diff, "function");
  assert.equal(typeof cjs.apply, "function");
  assert.equal(typeof cjs.TreeDiffError, "function");

  const lhs = { a: 1 };
  const rhs = { a: 2 };
  const delta = esm.diff(lhs, rhs);
  const target = { a: 1 };
  esm.apply(target, delta);
  assert.deepEqual(target, rhs);
});

