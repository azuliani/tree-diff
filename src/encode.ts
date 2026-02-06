import type { Key, Meta, RelPath } from "./types.ts";
import { TreeDiffError } from "./errors.ts";
import { assertFiniteNumber, isPlainObject } from "./utils.ts";

type Encoded = {
  value: unknown;
  d: RelPath[];
  u: RelPath[];
};

const EMPTY_PATHS: RelPath[] = Object.freeze([]) as unknown as RelPath[];

function appendPrefixed(dest: RelPath[], prefix: Key, paths: RelPath[]): void {
  for (const p of paths) {
    dest.push(p.length === 0 ? [prefix] : [prefix, ...p]);
  }
}

function encodeInner(value: unknown, stack: WeakSet<object>): Encoded {
  if (value === undefined) {
    return { value: null, d: EMPTY_PATHS, u: [[]] };
  }

  if (value === null) {
    return { value: null, d: EMPTY_PATHS, u: EMPTY_PATHS };
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return { value, d: EMPTY_PATHS, u: EMPTY_PATHS };
  }

  if (typeof value === "number") {
    assertFiniteNumber(value);
    return { value, d: EMPTY_PATHS, u: EMPTY_PATHS };
  }

  const t = typeof value;
  if (t === "bigint" || t === "symbol" || t === "function") {
    throw new TreeDiffError("UNSUPPORTED_TYPE", `Unsupported type: ${t}`);
  }

  if (value instanceof Date) {
    return { value: value.toISOString(), d: [[]], u: EMPTY_PATHS };
  }

  if (Array.isArray(value)) {
    if (stack.has(value)) throw new TreeDiffError("CYCLE_DETECTED");
    stack.add(value);
    try {
      const out: unknown[] = new Array(value.length);
      const d: RelPath[] = [];
      const u: RelPath[] = [];
      for (let i = 0; i < value.length; i++) {
        const child = encodeInner(value[i], stack);
        out[i] = child.value;
        appendPrefixed(d, i, child.d);
        appendPrefixed(u, i, child.u);
      }
      return { value: out, d, u };
    } finally {
      stack.delete(value);
    }
  }

  if (isPlainObject(value)) {
    if (stack.has(value)) throw new TreeDiffError("CYCLE_DETECTED");
    stack.add(value);
    try {
      const out: Record<string, unknown> = {};
      const d: RelPath[] = [];
      const u: RelPath[] = [];
      for (const k of Object.keys(value)) {
        const child = encodeInner(value[k], stack);
        out[k] = child.value;
        appendPrefixed(d, k, child.d);
        appendPrefixed(u, k, child.u);
      }
      return { value: out, d, u };
    } finally {
      stack.delete(value);
    }
  }

  throw new TreeDiffError("UNSUPPORTED_TYPE", "Unsupported object type");
}

function buildMeta(d: RelPath[], u: RelPath[]): Meta | undefined {
  if (d.length === 0 && u.length === 0) return undefined;
  const meta: Meta = {};
  if (d.length > 0) meta.d = d;
  if (u.length > 0) meta.u = u;
  return meta;
}

export function encode(value: unknown): { value: unknown; meta?: Meta } {
  const stack = new WeakSet<object>();
  const encoded = encodeInner(value, stack);
  const meta = buildMeta(encoded.d, encoded.u);
  return meta ? { value: encoded.value, meta } : { value: encoded.value };
}
