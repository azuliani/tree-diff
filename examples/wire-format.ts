// Wire-format demo:
// - Date values become ISO strings with `meta.d` paths
// - explicit undefined becomes null with `meta.u` paths
// - the delta round-trips through JSON and can still be applied
import assert from "node:assert/strict";

import { apply, diff } from "../src/index.ts";

const lhs = {
  profile: {
    audit: {
      createdAt: new Date("2026-02-04T00:00:00.000Z"),
      note: "hello",
      nested: {
        when: new Date("2026-02-04T12:34:56.000Z"),
        values: [1, 2, null],
      },
    },
  },
  payload: "legacy",
};

const rhs = {
  profile: {
    audit: {
      createdAt: new Date("2026-02-05T00:00:00.000Z"),
      note: undefined,
      nested: {
        when: new Date("2026-02-05T12:34:56.000Z"),
        values: [1, undefined, null],
      },
    },
  },
  payload: {
    deep: {
      points: [
        { at: new Date("2026-02-05T01:02:03.000Z"), note: undefined },
        { at: new Date("2026-02-06T04:05:06.000Z"), note: "ok" },
      ],
    },
  },
};

const delta = diff(lhs, rhs);
const wire = JSON.stringify(delta);
const parsed = JSON.parse(wire);

console.log("wire bytes:", Buffer.byteLength(wire, "utf8"));

type Key = string | number;

function formatPath(path: Key[], empty: string): string {
  if (path.length === 0) return empty;
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
      continue;
    }
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(seg)) {
      out += out === "" ? seg : `.${seg}`;
      continue;
    }
    out += `[${JSON.stringify(seg)}]`;
  }
  return out;
}

function isNode(entry: unknown): entry is [path: Key[], entries: unknown[]] {
  return Array.isArray(entry) && Array.isArray(entry[0]);
}

function flattenDelta(
  entries: unknown[],
  prefix: Key[] = []
): Array<{ path: Key[]; kind: "N" | "E" | "D"; rhs?: unknown; meta?: unknown }> {
  const out: Array<{ path: Key[]; kind: "N" | "E" | "D"; rhs?: unknown; meta?: unknown }> = [];

  for (const entry of entries) {
    if (isNode(entry)) {
      const [path, child] = entry;
      out.push(...flattenDelta(child, [...prefix, ...path]));
      continue;
    }
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [key, kind, rhs, meta] = entry as [Key, "N" | "E" | "D", unknown?, unknown?];
    out.push({ path: [...prefix, key], kind, rhs, meta });
  }

  return out;
}

function formatRelPaths(name: string, paths: unknown): string {
  if (!Array.isArray(paths) || paths.length === 0) return "";
  const formatted = paths.map((p) => formatPath(p as Key[], "<rhs>"));
  return ` ${name}=[${formatted.join(", ")}]`;
}

function formatRhs(rhs: unknown): string {
  if (rhs === null) return "null";
  if (typeof rhs === "string") return JSON.stringify(rhs);
  if (typeof rhs === "number" || typeof rhs === "boolean") return String(rhs);
  if (Array.isArray(rhs)) return `<array len=${rhs.length}>`;
  if (rhs && typeof rhs === "object") {
    const keys = Object.keys(rhs);
    return keys.length === 0 ? "<object>" : `<object keys=${keys.join(",")}>`;
  }
  return `<${typeof rhs}>`;
}

console.log("wire (flattened):");
for (const leaf of flattenDelta(parsed as unknown[])) {
  const rhsPart = leaf.kind === "D" ? "" : ` rhs=${formatRhs(leaf.rhs)}`;
  const meta = leaf.meta as { d?: unknown; u?: unknown } | undefined;
  const metaPart = meta
    ? `${formatRelPaths("d", meta.d)}${formatRelPaths("u", meta.u)}`
    : "";
  console.log(`- ${leaf.kind} ${formatPath(leaf.path, "<root>")}${rhsPart}${metaPart}`);
}

console.log("wire (json):");
for(let entry of parsed) {
  console.log(JSON.stringify(entry));
}

const target: any = structuredClone(lhs);
apply(target, parsed as any);

assert.equal(target.profile.audit.createdAt instanceof Date, true);
assert.equal(target.profile.audit.nested.when instanceof Date, true);
assert.equal(Object.prototype.hasOwnProperty.call(target.profile.audit, "note"), true);
assert.equal(target.profile.audit.note, undefined);
assert.equal(Object.prototype.hasOwnProperty.call(target.profile.audit.nested, "values"), true);
assert.equal(Object.prototype.hasOwnProperty.call(target.profile.audit.nested.values, "1"), true);
assert.equal(target.profile.audit.nested.values[1], undefined);
assert.equal(target.profile.audit.nested.values[2], null);
assert.equal(target.payload.deep.points[0].at instanceof Date, true);
assert.equal(target.payload.deep.points[1].at instanceof Date, true);
assert.equal(Object.prototype.hasOwnProperty.call(target.payload.deep.points[0], "note"), true);
assert.equal(target.payload.deep.points[0].note, undefined);
assert.deepEqual(target, rhs);

console.log("round-trip ok");
