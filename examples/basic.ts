// Basic demo: compute a delta with diff(), apply it, and assert the patched object equals rhs.
import assert from "node:assert/strict";

import { apply, diff } from "../src/index.ts";

const lhs = {
  name: "Alice",
  active: true,
  tags: ["a", "b"],
  profile: { createdAt: new Date("2026-02-04T00:00:00.000Z") },
};

const rhs = {
  name: "Bob",
  active: false,
  tags: ["a", "b", "c"],
  profile: { createdAt: new Date("2026-02-05T00:00:00.000Z") },
};

const delta = diff(lhs, rhs);
console.log("delta:", JSON.stringify(delta));

const target = structuredClone(lhs);
apply(target, delta);

assert.deepEqual(target, rhs);
console.log("patched ok");
