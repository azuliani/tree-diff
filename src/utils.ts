import type { Entry, Leaf, Node } from "./types.ts";
import { TreeDiffError } from "./errors.ts";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function sameContainerKind(a: unknown, b: unknown): boolean {
  return (
    (Array.isArray(a) && Array.isArray(b)) ||
    (isPlainObject(a) && isPlainObject(b))
  );
}

export function assertFiniteNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new TreeDiffError("UNSUPPORTED_TYPE", "Non-finite number");
  }
}

export function isNode(entry: Entry): entry is Node {
  return Array.isArray(entry[0]);
}

export function isLeaf(entry: Entry): entry is Leaf {
  return !Array.isArray(entry[0]);
}

