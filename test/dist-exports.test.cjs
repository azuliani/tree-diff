const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

test("dist sourcemaps embed sourcesContent", () => {
  const jsMapPaths = [
    path.resolve(__dirname, "..", "dist", "esm", "index.js.map"),
    path.resolve(__dirname, "..", "dist", "cjs", "index.js.map"),
  ];

  for (const p of jsMapPaths) {
    const raw = fs.readFileSync(p, "utf8");
    const map = JSON.parse(raw);
    assert.equal(Array.isArray(map.sourcesContent), true, `${path.basename(p)}: sourcesContent missing`);
    assert.ok(map.sourcesContent.length > 0, `${path.basename(p)}: sourcesContent empty`);
    for (const s of map.sourcesContent) {
      assert.equal(typeof s, "string", `${path.basename(p)}: sourcesContent entry must be a string`);
      assert.ok(s.length > 0, `${path.basename(p)}: sourcesContent entry empty`);
    }
  }

  const dtsMapPath = path.resolve(__dirname, "..", "dist", "types", "index.d.ts.map");
  const dtsRaw = fs.readFileSync(dtsMapPath, "utf8");
  const dtsMap = JSON.parse(dtsRaw);
  const sources = Array.isArray(dtsMap.sources) ? dtsMap.sources : [];
  assert.ok(sources.length > 0, "index.d.ts.map: missing sources");
  for (const src of sources) {
    assert.equal(typeof src, "string", "index.d.ts.map: source entry must be a string");
    const resolved = path.resolve(path.dirname(dtsMapPath), src);
    assert.ok(fs.existsSync(resolved), `index.d.ts.map: missing source file ${src}`);
  }
});
