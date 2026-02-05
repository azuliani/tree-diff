import type { Entry, Key, Leaf, Meta, Node, TreeDelta } from "./types.ts";
import { TreeDiffError } from "./errors.ts";
import { isPlainObject } from "./utils.ts";
import { restore } from "./restore.ts";

function isNode(entry: Entry): entry is Node {
  return Array.isArray(entry[0]);
}

function isLeaf(entry: Entry): entry is Leaf {
  return !Array.isArray(entry[0]);
}

function traverseNode(container: unknown, path: Key[]): unknown {
  if (path.length === 0) throw new TreeDiffError("TYPE_MISMATCH", "Node path must be non-empty");
  let cur: unknown = container;
  for (const seg of path) {
    if (Array.isArray(cur)) {
      if (typeof seg !== "number" || !Number.isInteger(seg) || seg < 0) {
        throw new TreeDiffError("TYPE_MISMATCH", "Expected array index");
      }
      if (seg >= cur.length) throw new TreeDiffError("TYPE_MISMATCH", "Index out of bounds");
      const next = cur[seg];
      if (!Array.isArray(next) && !isPlainObject(next)) {
        throw new TreeDiffError("TYPE_MISMATCH", "Expected container");
      }
      cur = next;
      continue;
    }
    if (isPlainObject(cur)) {
      if (typeof seg !== "string") throw new TreeDiffError("TYPE_MISMATCH", "Expected object key");
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) {
        throw new TreeDiffError("TYPE_MISMATCH", "Missing key");
      }
      const next = cur[seg];
      if (!Array.isArray(next) && !isPlainObject(next)) {
        throw new TreeDiffError("TYPE_MISMATCH", "Expected container");
      }
      cur = next;
      continue;
    }
    throw new TreeDiffError("TYPE_MISMATCH", "Node traverses non-container");
  }
  return cur;
}

function applyLeafInObject(obj: Record<string, unknown>, leaf: Leaf): void {
  const [key, kind] = leaf;
  if (typeof key !== "string") throw new TreeDiffError("TYPE_MISMATCH", "Object key must be string");

  const has = Object.prototype.hasOwnProperty.call(obj, key);

  if (kind === "N") {
    if (has) throw new TreeDiffError("PRECONDITION_FAILED");
    const rhs = leaf[2];
    const meta = leaf[3] as Meta | undefined;
    obj[key] = restore(rhs, meta);
    return;
  }

  if (kind === "E") {
    if (!has) throw new TreeDiffError("PRECONDITION_FAILED");
    const rhs = leaf[2];
    const meta = leaf[3] as Meta | undefined;
    obj[key] = restore(rhs, meta);
    return;
  }

  if (kind === "D") {
    if (!has) throw new TreeDiffError("PRECONDITION_FAILED");
    delete obj[key];
    return;
  }

  throw new TreeDiffError("PRECONDITION_FAILED", "Unknown leaf kind");
}

function applyLeafInArray(arr: unknown[], leaf: Leaf): void {
  const [key, kind] = leaf;
  if (typeof key !== "number" || !Number.isInteger(key) || key < 0) {
    throw new TreeDiffError("TYPE_MISMATCH", "Array index must be non-negative integer");
  }

  if (kind === "E") {
    if (!(0 <= key && key < arr.length)) throw new TreeDiffError("PRECONDITION_FAILED");
    const rhs = leaf[2];
    const meta = leaf[3] as Meta | undefined;
    arr[key] = restore(rhs, meta);
    return;
  }

  if (kind === "D") {
    if (key !== arr.length - 1) throw new TreeDiffError("PRECONDITION_FAILED");
    arr.pop();
    return;
  }

  if (kind === "N") {
    if (key !== arr.length) throw new TreeDiffError("PRECONDITION_FAILED");
    const rhs = leaf[2];
    const meta = leaf[3] as Meta | undefined;
    arr.push(restore(rhs, meta));
    return;
  }

  throw new TreeDiffError("PRECONDITION_FAILED", "Unknown leaf kind");
}

function applyEntries(container: unknown, entries: Entry[]): void {
  if (Array.isArray(container)) {
    applyEntriesArray(container, entries);
    return;
  }
  if (isPlainObject(container)) {
    for (const entry of entries) {
      if (isNode(entry)) {
        const [path, childEntries] = entry;
        const nested = traverseNode(container, path);
        applyEntries(nested, childEntries);
        continue;
      }
      applyLeafInObject(container, entry);
    }
    return;
  }
  throw new TreeDiffError("TYPE_MISMATCH", "Expected container");
}

function applyEntriesArray(arr: unknown[], entries: Entry[]): void {
  let hasN = false;
  let hasD = false;
  for (const entry of entries) {
    if (!isLeaf(entry)) continue;
    if (entry[1] === "N") hasN = true;
    if (entry[1] === "D") hasD = true;
  }
  if (hasN && hasD) throw new TreeDiffError("PRECONDITION_FAILED", "Array cannot have both N and D");

  // 1) nodes and E leaves (forward)
  for (const entry of entries) {
    if (isNode(entry)) {
      const [path, childEntries] = entry;
      const nested = traverseNode(arr, path);
      applyEntries(nested, childEntries);
      continue;
    }
    if (entry[1] === "E") applyLeafInArray(arr, entry);
  }

  if (hasD) {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!entry) continue;
      if (isLeaf(entry) && entry[1] === "D") applyLeafInArray(arr, entry);
    }
    return;
  }

  if (hasN) {
    for (const entry of entries) {
      if (isLeaf(entry) && entry[1] === "N") applyLeafInArray(arr, entry);
    }
  }
}

export function apply(target: object | unknown[], delta: TreeDelta | undefined): void {
  if (!delta || delta.length === 0) return;
  applyEntries(target, delta);
}
