import test from "node:test";
import assert from "node:assert/strict";

import { apply, diff, TreeDiffError } from "../src/index.ts";

test("diff() throws INVALID_ROOT for non-container roots", () => {
  assert.throws(
    () => diff(1, 2),
    (e) => e instanceof TreeDiffError && e.code === "INVALID_ROOT"
  );
});

test("object example: edit + delete", () => {
  const lhs = { name: "Alice", active: true };
  const rhs = { name: "Bob" };
  const delta = diff(lhs, rhs);
  assert.deepEqual(delta, [
    ["name", "E", "Bob"],
    ["active", "D"],
  ]);

  const target = { name: "Alice", active: true };
  apply(target, delta);
  assert.deepEqual(target, { name: "Bob" });
});

test("array tail push", () => {
  const lhs = [1, 2];
  const rhs = [1, 2, 3];
  const delta = diff(lhs, rhs);
  assert.deepEqual(delta, [[2, "N", 3]]);

  const target = [1, 2];
  apply(target, delta);
  assert.deepEqual(target, [1, 2, 3]);
});

test("array tail pop", () => {
  const lhs = [1, 2, 3];
  const rhs = [1, 2];
  const delta = diff(lhs, rhs);
  assert.deepEqual(delta, [[2, "D"]]);

  const target = [1, 2, 3];
  apply(target, delta);
  assert.deepEqual(target, [1, 2]);
});

test("date restoration", () => {
  const lhs = { createdAt: new Date("2026-02-04T00:00:00.000Z") };
  const rhs = { createdAt: new Date("2026-02-05T00:00:00.000Z") };
  const delta = diff(lhs, rhs);
  assert.deepEqual(delta, [
    ["createdAt", "E", "2026-02-05T00:00:00.000Z", { d: [[]] }],
  ]);

  const target = { createdAt: new Date("2026-02-04T00:00:00.000Z") };
  apply(target, delta);
  assert.equal(target.createdAt instanceof Date, true);
  assert.equal(target.createdAt.toISOString(), "2026-02-05T00:00:00.000Z");
});

test("undefined transfer (object)", () => {
  const lhs = { a: 1 };
  const rhs = { a: undefined };
  const delta = diff(lhs, rhs);
  assert.deepEqual(delta, [["a", "E", null, { u: [[]] }]]);

  const target: any = { a: 1 };
  apply(target, delta);
  assert.equal(Object.prototype.hasOwnProperty.call(target, "a"), true);
  assert.equal(target.a, undefined);
});

test("path compression nodes", () => {
  const lhs = { A: { B: { C: { D: 1, E: 2, F: 3 } } } };
  const rhs = { A: { B: { C: { D: 2, E: 3, F: 3 } } } };
  const delta = diff(lhs, rhs);
  assert.deepEqual(delta, [
    [["A", "B", "C"], [
      ["D", "E", 2],
      ["E", "E", 3],
    ]],
  ]);

  const target: any = { A: { B: { C: { D: 1, E: 2, F: 3 } } } };
  apply(target, delta);
  assert.deepEqual(target, rhs);
});

test("nested meta restoration inside leaf payload", () => {
  const lhs = { x: 1 };
  const rhs = { x: { createdAt: new Date("2026-02-05T00:00:00.000Z"), y: undefined } };
  const delta = diff(lhs, rhs);
  assert.deepEqual(delta, [
    ["x", "E", { createdAt: "2026-02-05T00:00:00.000Z", y: null }, { d: [["createdAt"]], u: [["y"]] }],
  ]);

  const target: any = { x: 1 };
  apply(target, delta);
  assert.equal(target.x.createdAt instanceof Date, true);
  assert.equal(target.x.createdAt.toISOString(), "2026-02-05T00:00:00.000Z");
  assert.equal(Object.prototype.hasOwnProperty.call(target.x, "y"), true);
  assert.equal(target.x.y, undefined);
});

test("unsupported types throw even when values are equal", () => {
  assert.throws(
    () => diff({ x: Infinity }, { x: Infinity }),
    (e) => e instanceof TreeDiffError && e.code === "UNSUPPORTED_TYPE"
  );

  const m = new Map();
  assert.throws(
    () => diff({ x: m }, { x: m }),
    (e) => e instanceof TreeDiffError && e.code === "UNSUPPORTED_TYPE"
  );
});

test("cycle detection", () => {
  const a: any = {};
  a.self = a;
  assert.throws(
    () => diff({ a }, { a }),
    (e) => e instanceof TreeDiffError && e.code === "CYCLE_DETECTED"
  );
});

test("apply() enforces strict preconditions", () => {
  assert.throws(
    () => apply({}, [["a", "D"]]),
    (e) => e instanceof TreeDiffError && e.code === "PRECONDITION_FAILED"
  );
});

test("apply() validates meta.u encoding", () => {
  assert.throws(
    () => apply({ a: 0 }, [["a", "E", 1, { u: [[]] }]]),
    (e) => e instanceof TreeDiffError && e.code === "INVALID_UNDEFINED_ENCODING"
  );

  assert.throws(
    () => apply({ a: 0 }, [["a", "E", null, { u: 123 as any }]]),
    (e) => e instanceof TreeDiffError && e.code === "INVALID_META"
  );
});

