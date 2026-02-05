# tree-diff Specification

Status: Draft (v0.1)  
Last updated: 2026-02-05

tree-diff is a tree/trie-based alternative to flat path diffs (e.g. `[{ path: [...], kind, ... }]`).
It groups shared path prefixes structurally and is designed for:

- Efficient diff computation and application
- Small, JSON-friendly wire format (tuples/arrays)
- Strict patching (detect mismatches early)
- Deterministic restoration of `Date` objects after JSON serialization
- Transfer of `undefined` values despite JSON not supporting them directly

This spec is intentionally conservative:

- No root replacement (patch mutates an existing root container)
- Arrays are index-based with tail-only adds/deletes (no splice/move/LCS)
- Cycles are illegal (diff throws)

---

## 1. Terminology

- **lhs**: left-hand-side (before) value.
- **rhs**: right-hand-side (after) value.
- **delta**: the encoded change set that transforms `lhs` into `rhs` when applied to a target equal to `lhs`.
- **container**: either a plain object or an array.
- **entry**: one node or leaf inside a delta.
- **path**: a sequence of keys used to traverse containers.

---

## 2. Supported Value Domain

tree-diff is intended for state that can be safely transferred over JSON plus two extensions:

### 2.1 Supported runtime values (inputs to `diff`)

- JSON primitives: `null`, `boolean`, `string`, finite `number`
- Arrays (treated as dense sequences by `length`)
- Plain objects (own enumerable string keys; prototype MUST be `Object.prototype` or `null`)
- `Date`
- `undefined` (distinct from deletion)

### 2.2 Unsupported runtime values

If encountered anywhere in `lhs` or `rhs` during diffing, the implementation MUST throw `UNSUPPORTED_TYPE`
unless it is explicitly supported by a future extension:

- `bigint`, `symbol`, `function`
- `RegExp` (and other class instances besides `Date`)
- `Map`, `Set`, typed arrays, `ArrayBuffer`, etc.
- non-finite numbers (`NaN`, `Infinity`, `-Infinity`)

### 2.3 Cycles

Cycles are illegal. If a cycle is encountered while traversing `lhs` or `rhs`, or while encoding metadata
for a leaf payload, the implementation MUST throw `CYCLE_DETECTED`.

Note: a non-cyclic shared reference (a DAG) is allowed; only circular references are rejected.

---

## 3. Delta Wire Format

### 3.1 Keys and paths

- `Key := string | number`
- **Object keys** MUST be strings.
- **Array indices** MUST be non-negative integers (numbers).

- `RelPath := Key[]`  
  A path relative to the leaf payload `rhs` value.

### 3.2 Leaf kinds

tree-diff preserves add vs edit vs delete:

- `'N'`: new (exists only in rhs)
- `'E'`: edit (exists in both but differs)
- `'D'`: delete (exists only in lhs)

Deletes and edits do **not** include `lhs` payloads.

### 3.3 Metadata (`meta`)

Leaves that carry `rhs` may include metadata for restoration after JSON serialization:

```ts
type Meta = {
  /** Date paths within rhs (relative to rhs). */
  d?: RelPath[];
  /** Undefined paths within rhs (relative to rhs). */
  u?: RelPath[];
};
```

Semantics:

- Each path in `meta.d` identifies a location in `rhs` that should be restored from an ISO string to a `Date`.
- Each path in `meta.u` identifies a location in `rhs` that should be restored from `null` to `undefined`.
- The empty path `[]` means “`rhs` itself”.

`meta` MUST be omitted if both `d` and `u` would be empty.

### 3.4 Entry types (tuples)

The delta is represented as a list of entries at the root.

An **Entry** is one of:

1. **Leaf entry**

```ts
type Leaf =
  | [key: Key, kind: 'D']
  | [key: Key, kind: 'N' | 'E', rhs: unknown, meta?: Meta];
```

2. **Node entry** (path-compressed trie node)

```ts
type Node = [path: Key[], entries: Entry[]]; // path.length >= 1, entries.length >= 1
```

Full delta:

```ts
type Entry = Leaf | Node;
type TreeDelta = Entry[]; // empty = no changes
```

### 3.5 Node semantics (path compression)

A node entry `[path, entries]` means:

1. Starting from the current container, traverse along `path[0]`, then `path[1]`, … until the final segment.
2. The value at that final segment MUST be a container (object/array).
3. Apply `entries` within that container.

This is a radix-trie encoding: a chain of single-child nodes SHOULD be compressed into a single node with a longer `path`.

---

## 4. Encoding Rules for `Date` and `undefined`

tree-diff deltas are intended to be JSON-stringified directly.
Because JSON does not represent `Date` or `undefined`, leaf payloads are encoded as follows.

### 4.1 `Date` encoding

When producing a leaf with payload `rhs`:

- Every `Date` inside `rhs` is encoded as `date.toISOString()` (a string).
- The relative locations of these dates are recorded in `meta.d`.

Example:

```ts
// semantic rhs:
{ createdAt: new Date("2026-02-05T00:00:00.000Z") }

// wire rhs:
{ createdAt: "2026-02-05T00:00:00.000Z" }

// meta:
{ d: [["createdAt"]] }
```

### 4.2 `undefined` encoding

When producing a leaf with payload `rhs`:

- Every `undefined` inside `rhs` is encoded as `null`.
- The relative locations are recorded in `meta.u`.

Example:

```ts
// semantic rhs:
{ a: undefined, b: null }

// wire rhs:
{ a: null, b: null }

// meta:
{ u: [["a"]] }
```

Important JSON notes:

- `null` is native JSON and round-trips.
- `undefined` is not: without this encoding, it would be dropped (object) or coerced (array).

### 4.3 Meta validity constraints

Implementations MUST enforce:

- `meta.d` and `meta.u` paths MUST be unique (no duplicates within each list).
- A path MUST NOT appear in both `meta.d` and `meta.u`.
- Each path MUST resolve to an existing location inside the encoded `rhs` payload:
  - For `meta.d`: the value at the path MUST be a string that parses into a valid Date.
  - For `meta.u`: the value at the path MUST be `null` in the encoded payload.

If violated during apply, throw `INVALID_META`.

### 4.4 `encode(value)` (Normative)

The diff algorithm references an `encode(value)` helper that produces a JSON-safe payload and metadata.

Signature (conceptual):

```ts
function encode(value: unknown): { value: unknown; meta?: Meta };
```

Rules:

- The returned `value` MUST be JSON-safe (no `Date`, no `undefined`, no cycles, no unsupported types).
- `meta.d` and `meta.u` (if present) are relative to the returned `value`.

Encoding:

- `Date` → `{ value: date.toISOString(), meta: { d: [[]] } }`
- `undefined` → `{ value: null, meta: { u: [[]] } }`
- `null | boolean | string | finite number` → `{ value }`
- `Array`:
  - For `i = 0..arr.length-1`, treat holes as `undefined` (i.e., read `arr[i]`).
  - Encode each element and collect child metas by prefixing their paths with `i`.
- Plain object:
  - For each own enumerable key `k` (in `Object.keys(obj)` order), encode the property value.
  - Collect child metas by prefixing their paths with `k`.

When combining child metas into a parent `meta`:

- If a child meta path is `[]`, the prefixed parent path is `[k]` (or `[i]` for arrays).
- Otherwise, the prefixed parent path is `[k, ...childPath]` (or `[i, ...childPath]`).

Cycle detection during `encode()` MUST throw `CYCLE_DETECTED` (see §6.4).

---

## 5. Canonical Delta Invariants (Normative)

These invariants define the canonical output of `diff()` and what `apply()` expects under strict mode.

### 5.1 No root replacement

- `diff(lhs, rhs)` MUST throw `INVALID_ROOT` unless both are containers of the same kind (both plain objects or both arrays).
- A delta MUST NOT represent replacing the root value.

### 5.2 Trie shape (uniqueness)

Within any container’s `entries` list:

- No two entries may target the same key:
  - A leaf `[k, ...]` targets head key `k`.
  - A node `[path, ...]` targets head key `path[0]`.
- A leaf and a node MUST NOT share the same head key.

Additionally, canonical deltas SHOULD be path-compressed:

- A node MUST NOT contain exactly one entry if that entry is itself a node; such chains MUST be merged by concatenating their `path` arrays.

### 5.3 New/delete entries are whole-subtree

For objects:

- If a key is new in rhs, canonical delta uses a leaf `['key','N', rhsSubtree, meta?]` (whole subtree payload).
- If a key is deleted in rhs, canonical delta uses a leaf `['key','D']`.

Canonical deltas MUST NOT represent a new key via a node that traverses into a missing container.

### 5.4 Arrays are tail-only

Inside an array container, canonical deltas obey:

- `'D'` leaves represent tail pops only.
- `'N'` leaves represent tail pushes only.
- `'N'` and `'D'` MUST NOT both appear under the same array container.

Strict apply enforces this via index preconditions (see §7.4).

---

## 6. Diff Algorithm (Normative)

Signature (conceptual):

```ts
function diff(lhs: unknown, rhs: unknown): TreeDelta | undefined;
```

### 6.1 General comparison rules

- Treat `Date` as atomic; equal iff `lhs.getTime() === rhs.getTime()`.
- Treat `undefined` as a value distinct from deletion:
  - Object property deletion is “missing key”, not “value is undefined”.
  - Array deletion is tail removal (length shrink), not “element is undefined”.

If two non-container values differ, emit a leaf `'E'` with the encoded rhs value.

### 6.2 Objects

Given two plain objects `L` and `R`:

1. For each own enumerable key `k` in `L` (in `Object.keys(L)` order):
   - If `R` does not have own key `k`: emit `[k, 'D']`.
   - Else recurse:
     - If the values are equal: emit nothing.
     - If both values are containers of the same kind: emit nested changes under `k` as a node (path-compressed as needed).
     - Otherwise: emit `[k, 'E', encode(R[k]).value, encode(R[k]).meta?]`.
2. For each own enumerable key `k` in `R` that is not an own key of `L` (in `Object.keys(R)` order):
   - Emit `[k, 'N', encode(R[k]).value, encode(R[k]).meta?]`.

### 6.3 Arrays

Given arrays `L` and `R`:

1. Let `minLen = Math.min(L.length, R.length)`.
2. For `i = 0..minLen-1`:
   - Recurse similarly to objects:
     - If equal: nothing.
     - If both containers: emit nested changes under index `i` as a node.
     - Else: emit `[i, 'E', encode(R[i]).value, encode(R[i]).meta?]`.
3. If `L.length > R.length`:
   - For `i = R.length..L.length-1`: emit `[i, 'D']`.
4. If `R.length > L.length`:
   - For `i = L.length..R.length-1`: emit `[i, 'N', encode(R[i]).value, encode(R[i]).meta?]`.

This is strictly index-based with tail-only adds/deletes.

### 6.4 Cycle detection

During traversal:

- Maintain a per-side stack of containers in the current recursion chain.
- If descending into a container already in that side’s stack, throw `CYCLE_DETECTED`.

---

## 7. Apply Algorithm (Strict) (Normative)

Signature (conceptual):

```ts
function apply(target: object | unknown[], delta: TreeDelta | undefined): void;
```

`apply()` mutates `target` in place.

### 7.1 Object key existence

Object key existence checks MUST use:

```ts
Object.prototype.hasOwnProperty.call(obj, key)
```

### 7.2 Node traversal (no creation)

For a node entry `[path, entries]`, `apply()` MUST traverse the existing object graph:

- Each segment MUST exist as an own property (objects) or as an in-bounds index (arrays).
- Each intermediate value MUST be a non-null container.

If a segment is missing or not a container, throw `TYPE_MISMATCH`.

### 7.3 Leaf preconditions (objects)

Applying a leaf `[key, kind, ...]` inside an object container:

- `'N'`: `hasOwnProperty(key)` MUST be false; then set `obj[key] = restored(rhs)`.
- `'E'`: `hasOwnProperty(key)` MUST be true; then set `obj[key] = restored(rhs)`.
- `'D'`: `hasOwnProperty(key)` MUST be true; then delete `obj[key]`.

If any precondition fails, throw `PRECONDITION_FAILED`.

### 7.4 Leaf preconditions (arrays)

Applying a leaf `[index, kind, ...]` inside an array container:

- `'E'`: `0 <= index < arr.length` MUST hold; then set `arr[index] = restored(rhs)`.
- `'D'`: `index === arr.length - 1` MUST hold; then `arr.pop()`.
- `'N'`: `index === arr.length` MUST hold; then `arr.push(restored(rhs))`.

If any precondition fails, throw `PRECONDITION_FAILED`.

Note: this enforces tail-only adds/deletes and the required ordering for correct application.

### 7.5 Restoration (`Date` and `undefined`)

When writing a leaf payload `rhs` into the target:

1. Start from the encoded `rhs` value.
2. If `meta.d` is present:
   - For each path `p` in `meta.d`, locate the value in `rhs` at `p`.
   - Replace that string with a `Date`.
   - If the located value is not a string, or parses to an invalid date, throw `INVALID_DATE`.
3. If `meta.u` is present:
   - For each path `p` in `meta.u`, locate the value in `rhs` at `p`.
   - Replace that `null` with `undefined`.
   - If the located value is not `null`, throw `INVALID_UNDEFINED_ENCODING`.

Restoration MUST be deterministic and MUST NOT use heuristic string matching.

Arrays and objects are restored in-place. Restoring `undefined` in arrays produces explicit `undefined` elements (not holes).

### 7.6 Entry application order

For object containers, entries may be applied in the order provided (strict preconditions will reject invalid deltas).

For array containers, to satisfy tail semantics efficiently:

1. Apply all nodes and `'E'` leaves first (in forward order).
2. If any `'D'` leaves exist, apply them by scanning entries in reverse order and applying only `'D'` leaves.
3. Else, apply any `'N'` leaves by scanning entries in forward order and applying only `'N'` leaves.

Because `'N'` and `'D'` are mutually exclusive in canonical deltas, this is O(entry_count).

---

## 8. Errors

Implementations MUST throw (at minimum) these errors:

- `INVALID_ROOT`: root is not a container, or lhs/rhs root kinds differ.
- `CYCLE_DETECTED`: a cycle encountered during traversal or encoding.
- `UNSUPPORTED_TYPE`: unsupported value encountered (including non-finite numbers).
- `TYPE_MISMATCH`: apply traversal hits missing/non-container where a node requires a container.
- `PRECONDITION_FAILED`: `'N'|'E'|'D'` existence/index preconditions fail.
- `INVALID_META`: malformed metadata (duplicates, overlaps, or invalid paths).
- `INVALID_DATE`: meta.d points to non-string or invalid date string.
- `INVALID_UNDEFINED_ENCODING`: meta.u points to a value that is not `null`.

---

## 9. Examples

### 9.1 Simple object changes

lhs:
```js
{ name: "Alice", active: true }
```

rhs:
```js
{ name: "Bob" }
```

delta:
```js
[
  ["name", "E", "Bob"],
  ["active", "D"]
]
```

### 9.2 Grouped prefix (path compression)

delta:
```js
[
  [["A", "B", "C"], [
    ["D", "E", "Change1"],
    ["E", "E", "Change2"],
    ["F", "E", "Change3"]
  ]]
]
```

### 9.3 Array tail add/delete

lhs: `[1, 2]` → rhs: `[1, 2, 3]`
```js
[
  [2, "N", 3]
]
```

lhs: `[1, 2, 3]` → rhs: `[1, 2]`
```js
[
  [2, "D"]
]
```

### 9.4 Date restoration

semantic rhs:
```js
{ createdAt: new Date("2026-02-05T00:00:00.000Z") }
```

wire delta:
```js
[
  ["createdAt", "E", "2026-02-05T00:00:00.000Z", { "d": [[]] }]
]
```

Note:

- In this example, the leaf payload (`rhs`) is the Date value for `createdAt`, so the relative date path is `[]`.
- If a leaf payload were an object like `{ createdAt: <Date> }`, then the relative date path would be `["createdAt"]`.

### 9.5 Undefined transfer

lhs:
```js
{ a: 1 }
```

rhs:
```js
{ a: undefined }
```

wire delta:
```js
[
  ["a", "E", null, { "u": [[]] }]
]
```

Explanation: payload uses `null` for JSON safety; `meta.u` indicates that this `null` should be restored to `undefined`.

---

## 10. Notes on Efficiency

- The delta structure shares path prefixes, reducing repeated `path` array allocations.
- `apply()` is single-pass over entries and O(number_of_meta_paths) for restoration.
- Array strategy is O(n) (no LCS/move detection).
