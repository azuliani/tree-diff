import type { Key, Meta, RelPath } from "./types.ts";
import { TreeDiffError } from "./errors.ts";
import { isPlainObject } from "./utils.ts";

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

function setAtPathCopy(
  root: unknown,
  path: RelPath,
  newValue: unknown,
  owned: WeakSet<object>,
  offset: number
): unknown {
  if (offset >= path.length) return newValue;

  const head = path[offset] as Key;

  if (Array.isArray(root)) {
    if (!isArrayIndexKey(head)) throw new TreeDiffError("INVALID_META", "Expected array index");
    if (head >= root.length) throw new TreeDiffError("INVALID_META", "Index out of bounds");

    const prevChild = root[head];
    const nextChild = offset + 1 >= path.length
      ? newValue
      : setAtPathCopy(prevChild, path, newValue, owned, offset + 1);

    if (nextChild === prevChild) return root;

    if (owned.has(root)) {
      root[head] = nextChild;
      return root;
    }

    const cloned = root.slice();
    cloned[head] = nextChild;
    owned.add(cloned);
    return cloned;
  }

  if (isPlainObject(root)) {
    if (typeof head !== "string") throw new TreeDiffError("INVALID_META", "Expected object key");
    if (!Object.prototype.hasOwnProperty.call(root, head)) {
      throw new TreeDiffError("INVALID_META", "Missing object key");
    }

    const prevChild = root[head];
    const nextChild = offset + 1 >= path.length
      ? newValue
      : setAtPathCopy(prevChild, path, newValue, owned, offset + 1);

    if (nextChild === prevChild) return root;

    if (owned.has(root)) {
      root[head] = nextChild;
      return root;
    }

    const proto = Object.getPrototypeOf(root);
    const cloned: Record<string, unknown> = Object.create(proto);
    for (const k of Object.keys(root)) cloned[k] = root[k];
    cloned[head] = nextChild;
    owned.add(cloned);
    return cloned;
  }

  throw new TreeDiffError("INVALID_META", "Path traverses non-container");
}

function getAtPath(root: unknown, path: RelPath): unknown {
  if (path.length === 0) return root;
  let cur: unknown = root;
  for (const seg of path) {
    if (Array.isArray(cur)) {
      if (!isArrayIndexKey(seg)) throw new TreeDiffError("INVALID_META", "Expected array index");
      if (seg >= cur.length) throw new TreeDiffError("INVALID_META", "Index out of bounds");
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

function restoreDates(root: unknown, paths: RelPath[], owned: WeakSet<object>): unknown {
  let out: unknown = root;
  for (const p of paths) {
    const v = getAtPath(out, p);
    if (typeof v !== "string") throw new TreeDiffError("INVALID_DATE", "Expected date string");
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new TreeDiffError("INVALID_DATE", "Invalid date string");
    out = setAtPathCopy(out, p, d, owned, 0);
  }
  return out;
}

function restoreUndefined(out: unknown, paths: RelPath[], owned: WeakSet<object>): unknown {
  let root: unknown = out;
  for (const p of paths) {
    const v = getAtPath(root, p);
    if (v !== null) throw new TreeDiffError("INVALID_UNDEFINED_ENCODING", "Expected null for undefined");
    root = setAtPathCopy(root, p, undefined, owned, 0);
  }
  return root;
}

export function restore(encodedRhs: unknown, meta?: Meta): unknown {
  if (meta === undefined) return encodedRhs;
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    throw new TreeDiffError("INVALID_META", "meta must be an object");
  }

  assertMetaValid(meta as Meta);

  const owned = new WeakSet<object>();
  let out: unknown = encodedRhs;
  const d = (meta as Meta).d;
  const u = (meta as Meta).u;
  if (d && d.length > 0) out = restoreDates(out, d, owned);
  if (u && u.length > 0) out = restoreUndefined(out, u, owned);
  return out;
}
