import { TreeDiffError } from "./errors.ts";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isContainer(value: unknown): value is object {
  return Array.isArray(value) || isPlainObject(value);
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

export function assertSupportedScalar(value: unknown): void {
  switch (typeof value) {
    case "string":
    case "boolean":
    case "undefined":
      return;
    case "number":
      assertFiniteNumber(value);
      return;
    case "object":
      if (value === null) return;
      if (value instanceof Date) return;
      throw new TreeDiffError("UNSUPPORTED_TYPE", "Unsupported object type");
    default:
      throw new TreeDiffError("UNSUPPORTED_TYPE", `Unsupported type: ${typeof value}`);
  }
}

export function assertKey(key: unknown): asserts key is string | number {
  if (typeof key === "string") return;
  if (typeof key === "number" && Number.isInteger(key) && key >= 0) return;
  throw new TreeDiffError("UNSUPPORTED_TYPE", "Invalid key type");
}

export function deepCloneJson(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value !== "object") return value;
  const sc = (globalThis as unknown as { structuredClone?: (v: unknown) => unknown })
    .structuredClone;
  if (typeof sc === "function") return sc(value);
  return JSON.parse(JSON.stringify(value)) as unknown;
}
