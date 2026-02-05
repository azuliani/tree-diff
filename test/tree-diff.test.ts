import test from "node:test";
import assert from "node:assert/strict";

import { apply, diff, TreeDiffError } from "../src/index.ts";

test("diff() throws INVALID_ROOT for non-container roots", () => {
  assert.throws(
    () => diff(1, 2),
    (e) => e instanceof TreeDiffError && e.code === "INVALID_ROOT"
  );
});

test("diff() returns [] for deep-equal objects", () => {
  const lhs = { a: { b: [1, { c: "x" }] } };
  const rhs = { a: { b: [1, { c: "x" }] } };
  assert.deepEqual(diff(lhs, rhs), []);
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

test("apply() reuses rhs reference when meta is undefined", () => {
  const lhs: any = { x: 0 };
  const rhs: any = { x: { a: 1, b: [1, 2] } };
  const delta: any = diff(lhs, rhs);
  assert.equal(Array.isArray(delta), true);

  const target: any = { x: 0 };
  apply(target, delta);

  assert.equal(target.x, delta[0][2]);
  assert.deepEqual(target, rhs);
});

test("apply() does not mutate delta rhs when meta is present", () => {
  const lhs: any = { x: 1 };
  const rhs: any = { x: { createdAt: new Date("2026-02-05T00:00:00.000Z"), y: undefined } };
  const delta: any = diff(lhs, rhs);
  const encodedRhs = delta[0][2];

  const target: any = { x: 1 };
  apply(target, delta);

  assert.equal(typeof encodedRhs.createdAt, "string");
  assert.equal(encodedRhs.createdAt, "2026-02-05T00:00:00.000Z");
  assert.equal(encodedRhs.y, null);
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

// --- Additional coverage tests ---

test("diff() throws INVALID_ROOT for cross-kind containers", () => {
  assert.throws(
    () => diff([], {}),
    (e) => e instanceof TreeDiffError && e.code === "INVALID_ROOT"
  );
  assert.throws(
    () => diff({}, []),
    (e) => e instanceof TreeDiffError && e.code === "INVALID_ROOT"
  );
});

test("diff() returns [] for identical empty containers", () => {
  assert.deepEqual(diff({}, {}), []);
  assert.deepEqual(diff([], []), []);
});

test("apply() is a no-op for undefined or empty delta", () => {
  const obj = { a: 1 };
  apply(obj, undefined);
  assert.deepEqual(obj, { a: 1 });

  apply(obj, []);
  assert.deepEqual(obj, { a: 1 });
});

test("array-of-objects diff/apply", () => {
  const lhs = [{ id: 1, v: "a" }];
  const rhs = [{ id: 1, v: "b" }];
  const delta = diff(lhs, rhs);
  const target = [{ id: 1, v: "a" }];
  apply(target, delta);
  assert.deepEqual(target, rhs);
});

test("array-of-arrays diff/apply", () => {
  const lhs = [[1, 2], [3]];
  const rhs = [[1, 3], [3]];
  const delta = diff(lhs, rhs);
  const target: unknown[][] = [[1, 2], [3]];
  apply(target, delta);
  assert.deepEqual(target, rhs);
});

test("multiple tail pushes", () => {
  const lhs = [1];
  const rhs = [1, 2, 3, 4];
  const delta = diff(lhs, rhs);
  const target = [1];
  apply(target, delta);
  assert.deepEqual(target, rhs);
});

test("multiple tail pops", () => {
  const lhs = [1, 2, 3, 4];
  const rhs = [1];
  const delta = diff(lhs, rhs);
  const target = [1, 2, 3, 4];
  apply(target, delta);
  assert.deepEqual(target, rhs);
});

test("array edit + push combined", () => {
  const lhs = [10, 20];
  const rhs = [11, 21, 30, 40];
  const delta = diff(lhs, rhs);
  const target = [10, 20];
  apply(target, delta);
  assert.deepEqual(target, rhs);
});

test("node traversal through array index during apply", () => {
  const lhs = [{ key: "old" }];
  const rhs = [{ key: "new" }];
  const delta = diff(lhs, rhs);
  const target = [{ key: "old" }];
  apply(target, delta);
  assert.deepEqual(target, rhs);
});

test("JSON round-trip: apply with serialized delta", () => {
  const lhs = { a: new Date("2026-01-01T00:00:00.000Z"), b: undefined, c: [1, 2] };
  const rhs = { a: new Date("2026-06-01T00:00:00.000Z"), b: undefined, c: [1, 3] };
  const delta = diff(lhs, rhs);
  const roundTripped = JSON.parse(JSON.stringify(delta));
  const target: any = { a: new Date("2026-01-01T00:00:00.000Z"), b: undefined, c: [1, 2] };
  apply(target, roundTripped);
  assert.deepEqual(target.a, new Date("2026-06-01T00:00:00.000Z"));
  assert.deepEqual(target.c, [1, 3]);
});

test("date values inside arrays", () => {
  const d1 = new Date("2026-01-01T00:00:00.000Z");
  const d2 = new Date("2026-06-01T00:00:00.000Z");
  const lhs = [d1];
  const rhs = [d2];
  const delta = diff(lhs, rhs);
  const target: any[] = [new Date("2026-01-01T00:00:00.000Z")];
  apply(target, delta);
  assert.equal(target[0] instanceof Date, true);
  assert.equal(target[0].toISOString(), "2026-06-01T00:00:00.000Z");
});

test("undefined values inside arrays", () => {
  const lhs = [1];
  const rhs = [undefined];
  const delta = diff(lhs, rhs);
  assert.deepEqual(delta, [[0, "E", null, { u: [[]] }]]);
  const target: any[] = [1];
  apply(target, delta);
  assert.equal(target[0], undefined);
});

test("null-prototype objects", () => {
  const lhs = Object.create(null);
  lhs.a = 1;
  const rhs = Object.create(null);
  rhs.a = 2;
  const delta = diff(lhs, rhs);
  apply(lhs, delta);
  assert.equal(lhs.a, 2);
});

test("DAG shared references (non-cyclic)", () => {
  const shared = { x: 1 };
  const lhs = { a: shared, b: shared };
  const rhs = { a: { x: 2 }, b: { x: 2 } };
  const delta = diff(lhs, rhs);
  const target: any = { a: { x: 1 }, b: { x: 1 } };
  apply(target, delta);
  assert.deepEqual(target, rhs);
});

test("TYPE_MISMATCH: apply delta to structurally wrong target", () => {
  const delta = diff({ a: { b: 1 } }, { a: { b: 2 } });
  assert.throws(
    () => apply({ a: "not-an-object" } as any, delta),
    (e) => e instanceof TreeDiffError && e.code === "TYPE_MISMATCH"
  );
});

test("INVALID_DATE: meta.d pointing to non-date-string", () => {
  assert.throws(
    () => apply({ a: 0 }, [["a", "E", 123, { d: [[]] }]]),
    (e) => e instanceof TreeDiffError && e.code === "INVALID_DATE"
  );
});

test("direct array root diff/apply", () => {
  const lhs = [1, 2];
  const rhs = [1, 3];
  const delta = diff(lhs, rhs);
  const target = [1, 2];
  apply(target, delta);
  assert.deepEqual(target, [1, 3]);
});
