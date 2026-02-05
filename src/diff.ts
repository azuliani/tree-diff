import type { Entry, Key, TreeDelta } from "./types.ts";
import type { Meta } from "./types.ts";
import { TreeDiffError } from "./errors.ts";
import { encode } from "./encode.ts";
import { isPlainObject, sameContainerKind } from "./utils.ts";

function isNode(entry: Entry): entry is [path: Key[], entries: Entry[]] {
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

function assertSupportedValue(value: unknown): void {
  if (value === null) return;

  const t = typeof value;
  switch (t) {
    case "string":
    case "boolean":
    case "undefined":
      return;
    case "number":
      if (!Number.isFinite(value)) throw new TreeDiffError("UNSUPPORTED_TYPE", "Non-finite number");
      return;
    case "bigint":
    case "symbol":
    case "function":
      throw new TreeDiffError("UNSUPPORTED_TYPE", `Unsupported type: ${t}`);
    case "object":
      if (value instanceof Date) return;
      if (Array.isArray(value)) return;
      if (isPlainObject(value)) return;
      throw new TreeDiffError("UNSUPPORTED_TYPE", "Unsupported object type");
    default:
      throw new TreeDiffError("UNSUPPORTED_TYPE", `Unsupported type: ${t}`);
  }
}

function validateSubtree(value: unknown, stack: WeakSet<object>): void {
  assertSupportedValue(value);
  if (!value || typeof value !== "object") return;
  if (!(Array.isArray(value) || isPlainObject(value))) return;

  if (stack.has(value)) throw new TreeDiffError("CYCLE_DETECTED");
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) validateSubtree(value[i], stack);
      return;
    }
    for (const k of Object.keys(value)) validateSubtree(value[k], stack);
  } finally {
    stack.delete(value);
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
      assertSupportedValue(l);

      if (!Object.prototype.hasOwnProperty.call(rhs, k)) {
        validateSubtree(l, lhsStack);
        out.push([k, "D"]);
        continue;
      }

      const r = rhs[k];
      assertSupportedValue(r);

      if (Array.isArray(l) && Array.isArray(r)) {
        const child = diffArray(l, r, lhsStack, rhsStack);
        if (child.length > 0) out.push(wrapNode(k, child));
        continue;
      }

      if (isPlainObject(l) && isPlainObject(r)) {
        const child = diffObject(l, r, lhsStack, rhsStack);
        if (child.length > 0) out.push(wrapNode(k, child));
        continue;
      }

      if (valuesEqual(l, r)) continue;

      // If lhs is a container and we aren't recursing, we must still validate it fully.
      validateSubtree(l, lhsStack);
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
      assertSupportedValue(l);
      assertSupportedValue(r);

      if (Array.isArray(l) && Array.isArray(r)) {
        const child = diffArray(l, r, lhsStack, rhsStack);
        if (child.length > 0) out.push(wrapNode(i, child));
        continue;
      }

      if (isPlainObject(l) && isPlainObject(r)) {
        const child = diffObject(l, r, lhsStack, rhsStack);
        if (child.length > 0) out.push(wrapNode(i, child));
        continue;
      }

      if (valuesEqual(l, r)) continue;

      validateSubtree(l, lhsStack);
      const encoded = encode(r);
      out.push(leaf(i, "E", encoded.value, encoded.meta));
    }

    if (lhs.length > rhs.length) {
      for (let i = rhs.length; i < lhs.length; i++) {
        validateSubtree(lhs[i], lhsStack);
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

export function diff(lhs: unknown, rhs: unknown): TreeDelta | undefined {
  if (!sameContainerKind(lhs, rhs)) throw new TreeDiffError("INVALID_ROOT");

  const lhsStack = new WeakSet<object>();
  const rhsStack = new WeakSet<object>();

  const entries = Array.isArray(lhs)
    ? diffArray(lhs, rhs as unknown[], lhsStack, rhsStack)
    : diffObject(lhs as Record<string, unknown>, rhs as Record<string, unknown>, lhsStack, rhsStack);

  return entries.length === 0 ? undefined : entries;
}
