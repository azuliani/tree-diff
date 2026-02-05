import type { Entry, Key, Meta, Node, TreeDelta } from "./types.ts";
import { TreeDiffError } from "./errors.ts";
import { encode } from "./encode.ts";
import { isPlainObject, sameContainerKind } from "./utils.ts";

function isNode(entry: Entry): entry is Node {
  return Array.isArray(entry[0]);
}

function wrapNode(head: Key, entries: Entry[]): Entry {
  if (entries.length === 1) {
    const only = entries[0];
    if (only && isNode(only)) {
      const [path, inner] = only;
      return [[head, ...path], inner];
    }
  }
  return [[head], entries];
}

const KIND_SCALAR = 0;
const KIND_DATE = 1;
const KIND_ARRAY = 2;
const KIND_OBJECT = 3;

function kindOf(value: unknown): 0 | 1 | 2 | 3 {
  if (value === null) return KIND_SCALAR;

  const t = typeof value;
  switch (t) {
    case "string":
    case "boolean":
    case "undefined":
      return KIND_SCALAR;
    case "number":
      if (!Number.isFinite(value)) throw new TreeDiffError("UNSUPPORTED_TYPE", "Non-finite number");
      return KIND_SCALAR;
    case "object":
      if (value instanceof Date) return KIND_DATE;
      if (Array.isArray(value)) return KIND_ARRAY;
      if (isPlainObject(value)) return KIND_OBJECT;
      throw new TreeDiffError("UNSUPPORTED_TYPE", "Unsupported object type");
    default:
      throw new TreeDiffError("UNSUPPORTED_TYPE", `Unsupported type: ${t}`);
  }
}

function validateContainerSubtree(
  value: unknown[] | Record<string, unknown>,
  kind: 2 | 3,
  stack: WeakSet<object>
): void {
  if (stack.has(value)) throw new TreeDiffError("CYCLE_DETECTED");
  stack.add(value);
  try {
    if (kind === KIND_ARRAY) {
      const arr = value as unknown[];
      for (let i = 0; i < arr.length; i++) validateSubtree(arr[i], stack);
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) validateSubtree(obj[k], stack);
  } finally {
    stack.delete(value);
  }
}

function validateSubtree(value: unknown, stack: WeakSet<object>): void {
  const kind = kindOf(value);
  if (kind === KIND_ARRAY || kind === KIND_OBJECT) {
    validateContainerSubtree(value as unknown[] | Record<string, unknown>, kind, stack);
  }
}

function valuesEqual(lhs: unknown, rhs: unknown): boolean {
  if (lhs instanceof Date && rhs instanceof Date) return lhs.getTime() === rhs.getTime();
  return lhs === rhs;
}

function leaf(key: Key, kind: "N" | "E", rhs: unknown, meta?: Meta): Entry {
  return meta ? [key, kind, rhs, meta] : [key, kind, rhs];
}

function diffObject(
  lhs: Record<string, unknown>,
  rhs: Record<string, unknown>,
  lhsStack: WeakSet<object>,
  rhsStack: WeakSet<object>
): Entry[] {
  if (lhsStack.has(lhs)) throw new TreeDiffError("CYCLE_DETECTED");
  if (rhsStack.has(rhs)) throw new TreeDiffError("CYCLE_DETECTED");

  lhsStack.add(lhs);
  rhsStack.add(rhs);
  try {
    const out: Entry[] = [];

    for (const k of Object.keys(lhs)) {
      const l = lhs[k];
      const lk = kindOf(l);

      if (!Object.prototype.hasOwnProperty.call(rhs, k)) {
        if (lk === KIND_ARRAY || lk === KIND_OBJECT) {
          validateContainerSubtree(l as unknown[] | Record<string, unknown>, lk, lhsStack);
        }
        out.push([k, "D"]);
        continue;
      }

      const r = rhs[k];
      const rk = kindOf(r);

      if (lk === KIND_ARRAY && rk === KIND_ARRAY) {
        const child = diffArray(l as unknown[], r as unknown[], lhsStack, rhsStack);
        if (child.length > 0) out.push(wrapNode(k, child));
        continue;
      }

      if (lk === KIND_OBJECT && rk === KIND_OBJECT) {
        const child = diffObject(l as Record<string, unknown>, r as Record<string, unknown>, lhsStack, rhsStack);
        if (child.length > 0) out.push(wrapNode(k, child));
        continue;
      }

      if (lk === rk && valuesEqual(l, r)) continue;

      // If lhs is a container and we aren't recursing, we must still validate it fully.
      if (lk === KIND_ARRAY || lk === KIND_OBJECT) {
        validateContainerSubtree(l as unknown[] | Record<string, unknown>, lk, lhsStack);
      }
      const encoded = encode(r);
      out.push(leaf(k, "E", encoded.value, encoded.meta));
    }

    for (const k of Object.keys(rhs)) {
      if (Object.prototype.hasOwnProperty.call(lhs, k)) continue;
      const encoded = encode(rhs[k]);
      out.push(leaf(k, "N", encoded.value, encoded.meta));
    }

    return out;
  } finally {
    lhsStack.delete(lhs);
    rhsStack.delete(rhs);
  }
}

function diffArray(
  lhs: unknown[],
  rhs: unknown[],
  lhsStack: WeakSet<object>,
  rhsStack: WeakSet<object>
): Entry[] {
  if (lhsStack.has(lhs)) throw new TreeDiffError("CYCLE_DETECTED");
  if (rhsStack.has(rhs)) throw new TreeDiffError("CYCLE_DETECTED");

  lhsStack.add(lhs);
  rhsStack.add(rhs);
  try {
    const out: Entry[] = [];
    const minLen = Math.min(lhs.length, rhs.length);

    for (let i = 0; i < minLen; i++) {
      const l = lhs[i];
      const r = rhs[i];
      const lk = kindOf(l);
      const rk = kindOf(r);

      if (lk === KIND_ARRAY && rk === KIND_ARRAY) {
        const child = diffArray(l as unknown[], r as unknown[], lhsStack, rhsStack);
        if (child.length > 0) out.push(wrapNode(i, child));
        continue;
      }

      if (lk === KIND_OBJECT && rk === KIND_OBJECT) {
        const child = diffObject(l as Record<string, unknown>, r as Record<string, unknown>, lhsStack, rhsStack);
        if (child.length > 0) out.push(wrapNode(i, child));
        continue;
      }

      if (lk === rk && valuesEqual(l, r)) continue;

      if (lk === KIND_ARRAY || lk === KIND_OBJECT) {
        validateContainerSubtree(l as unknown[] | Record<string, unknown>, lk, lhsStack);
      }
      const encoded = encode(r);
      out.push(leaf(i, "E", encoded.value, encoded.meta));
    }

    if (lhs.length > rhs.length) {
      for (let i = rhs.length; i < lhs.length; i++) {
        const lk = kindOf(lhs[i]);
        if (lk === KIND_ARRAY || lk === KIND_OBJECT) {
          validateContainerSubtree(lhs[i] as unknown[] | Record<string, unknown>, lk, lhsStack);
        }
        out.push([i, "D"]);
      }
    } else if (rhs.length > lhs.length) {
      for (let i = lhs.length; i < rhs.length; i++) {
        const encoded = encode(rhs[i]);
        out.push(leaf(i, "N", encoded.value, encoded.meta));
      }
    }

    return out;
  } finally {
    lhsStack.delete(lhs);
    rhsStack.delete(rhs);
  }
}

export function diff(lhs: unknown, rhs: unknown): TreeDelta {
  if (!sameContainerKind(lhs, rhs)) throw new TreeDiffError("INVALID_ROOT");

  const lhsStack = new WeakSet<object>();
  const rhsStack = new WeakSet<object>();

  const entries = Array.isArray(lhs)
    ? diffArray(lhs, rhs as unknown[], lhsStack, rhsStack)
    : diffObject(lhs as Record<string, unknown>, rhs as Record<string, unknown>, lhsStack, rhsStack);

  return entries;
}
