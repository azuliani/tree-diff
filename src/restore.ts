import type { Key, Meta, RelPath } from "./types.ts";
import { TreeDiffError } from "./errors.ts";
import { deepCloneJson, isPlainObject } from "./utils.ts";

function pathId(path: RelPath): string {
  return JSON.stringify(path);
}

function assertRelPath(value: unknown): asserts value is RelPath {
  if (!Array.isArray(value)) throw new TreeDiffError("INVALID_META", "Meta path must be an array");
  for (const seg of value) {
    if (typeof seg === "string") continue;
    if (typeof seg === "number" && Number.isInteger(seg) && seg >= 0) continue;
    throw new TreeDiffError(
      "INVALID_META",
      "Meta path segments must be strings or non-negative integers"
    );
  }
}

function assertMetaValid(meta: Meta): void {
  if (meta.d !== undefined && !Array.isArray(meta.d)) {
    throw new TreeDiffError("INVALID_META", "meta.d must be an array");
  }
  if (meta.u !== undefined && !Array.isArray(meta.u)) {
    throw new TreeDiffError("INVALID_META", "meta.u must be an array");
  }

  const d = (meta.d ?? []) as unknown[];
  const u = (meta.u ?? []) as unknown[];

  const dSet = new Set<string>();
  for (const p of d) {
    assertRelPath(p);
    const id = pathId(p);
    if (dSet.has(id)) throw new TreeDiffError("INVALID_META", "Duplicate meta.d path");
    dSet.add(id);
  }

  const uSet = new Set<string>();
  for (const p of u) {
    assertRelPath(p);
    const id = pathId(p);
    if (uSet.has(id)) throw new TreeDiffError("INVALID_META", "Duplicate meta.u path");
    uSet.add(id);
  }

  for (const id of dSet) {
    if (uSet.has(id)) throw new TreeDiffError("INVALID_META", "Path appears in both d and u");
  }
}

function isArrayIndexKey(key: Key): key is number {
  return typeof key === "number" && Number.isInteger(key) && key >= 0;
}

function resolveParent(
  root: unknown,
  path: RelPath
): { parent: unknown; key: Key } {
  if (path.length === 0) throw new Error("resolveParent called with empty path");
  let cur: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i] as Key;
    if (Array.isArray(cur)) {
      if (!isArrayIndexKey(seg)) throw new TreeDiffError("INVALID_META", "Expected array index");
      if (seg < 0 || seg >= cur.length) throw new TreeDiffError("INVALID_META", "Index out of bounds");
      cur = cur[seg];
      continue;
    }
    if (isPlainObject(cur)) {
      if (typeof seg !== "string") throw new TreeDiffError("INVALID_META", "Expected object key");
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) {
        throw new TreeDiffError("INVALID_META", "Missing object key");
      }
      cur = cur[seg];
      continue;
    }
    throw new TreeDiffError("INVALID_META", "Path traverses non-container");
  }
  return { parent: cur, key: path[path.length - 1] as Key };
}

function setAtPath(root: unknown, path: RelPath, newValue: unknown): unknown {
  if (path.length === 0) return newValue;
  const { parent, key } = resolveParent(root, path);

  if (Array.isArray(parent)) {
    if (!isArrayIndexKey(key)) throw new TreeDiffError("INVALID_META", "Expected array index");
    if (key < 0 || key >= parent.length) throw new TreeDiffError("INVALID_META", "Index out of bounds");
    parent[key] = newValue;
    return root;
  }

  if (isPlainObject(parent)) {
    if (typeof key !== "string") throw new TreeDiffError("INVALID_META", "Expected object key");
    if (!Object.prototype.hasOwnProperty.call(parent, key)) {
      throw new TreeDiffError("INVALID_META", "Missing object key");
    }
    parent[key] = newValue;
    return root;
  }

  throw new TreeDiffError("INVALID_META", "Path resolves to non-container parent");
}

function getAtPath(root: unknown, path: RelPath): unknown {
  if (path.length === 0) return root;
  let cur: unknown = root;
  for (const seg of path) {
    if (Array.isArray(cur)) {
      if (!isArrayIndexKey(seg)) throw new TreeDiffError("INVALID_META", "Expected array index");
      if (seg < 0 || seg >= cur.length) throw new TreeDiffError("INVALID_META", "Index out of bounds");
      cur = cur[seg];
      continue;
    }
    if (isPlainObject(cur)) {
      if (typeof seg !== "string") throw new TreeDiffError("INVALID_META", "Expected object key");
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) {
        throw new TreeDiffError("INVALID_META", "Missing object key");
      }
      cur = cur[seg];
      continue;
    }
    throw new TreeDiffError("INVALID_META", "Path traverses non-container");
  }
  return cur;
}

function restoreDates(root: unknown, paths: RelPath[]): unknown {
  let out = root;
  for (const p of paths) {
    const v = getAtPath(out, p);
    if (typeof v !== "string") throw new TreeDiffError("INVALID_DATE", "Expected date string");
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new TreeDiffError("INVALID_DATE", "Invalid date string");
    out = setAtPath(out, p, d);
  }
  return out;
}

function restoreUndefined(out: unknown, paths: RelPath[]): unknown {
  let root = out;
  for (const p of paths) {
    const v = getAtPath(root, p);
    if (v !== null) throw new TreeDiffError("INVALID_UNDEFINED_ENCODING", "Expected null for undefined");
    root = setAtPath(root, p, undefined);
  }
  return root;
}

export function restore(encodedRhs: unknown, meta?: Meta | null): unknown {
  if (meta === undefined) return deepCloneJson(encodedRhs);
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    throw new TreeDiffError("INVALID_META", "meta must be an object");
  }

  assertMetaValid(meta as Meta);

  let out = deepCloneJson(encodedRhs);
  const d = (meta as Meta).d;
  const u = (meta as Meta).u;
  if (d && d.length > 0) out = restoreDates(out, d);
  if (u && u.length > 0) out = restoreUndefined(out, u);
  return out;
}
