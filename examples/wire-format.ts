import assert from "node:assert/strict";

import { apply, diff } from "../src/index.ts";

const lhs = {
  createdAt: new Date("2026-02-04T00:00:00.000Z"),
  note: "hello",
  nested: {
    when: new Date("2026-02-04T12:34:56.000Z"),
    values: [1, 2, null],
  },
};

const rhs = {
  createdAt: new Date("2026-02-05T00:00:00.000Z"),
  note: undefined,
  nested: {
    when: new Date("2026-02-05T12:34:56.000Z"),
    values: [1, undefined, null],
  },
};

const delta = diff(lhs, rhs);
const wire = JSON.stringify(delta);
const parsed = JSON.parse(wire);

console.log("wire bytes:", Buffer.byteLength(wire, "utf8"));
console.log("wire:", JSON.stringify(parsed, null, 2));

const target: any = structuredClone(lhs);
apply(target, parsed as any);

assert.equal(target.createdAt instanceof Date, true);
assert.equal(target.nested.when instanceof Date, true);
assert.equal(Object.prototype.hasOwnProperty.call(target, "note"), true);
assert.equal(target.note, undefined);
assert.equal(Object.prototype.hasOwnProperty.call(target.nested, "values"), true);
assert.equal(Object.prototype.hasOwnProperty.call(target.nested.values, "1"), true);
assert.equal(target.nested.values[1], undefined);
assert.equal(target.nested.values[2], null);
assert.deepEqual(target, rhs);

console.log("round-trip ok");
