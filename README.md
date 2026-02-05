# tree-diff

Tree/trie-based **JSON-friendly diff** + **strict patcher** for plain objects and arrays.

- Deltas are compact (path-compressed trie) and can be `JSON.stringify()`’d directly.
- `apply()` is strict: it refuses to patch if the target doesn’t match the expected shape.
- Preserves `Date` and `undefined` across JSON using per-leaf metadata.

Status: draft (v0.1).

## Install

```sh
npm i @azuliani/tree-diff
```

Node: `>=23.6.0` (see `package.json` `engines`).

## Quick start

```ts
import { apply, diff } from "@azuliani/tree-diff";

const lhs = { name: "Alice", createdAt: new Date("2026-02-04T00:00:00.000Z") };
const rhs = { name: "Bob", createdAt: new Date("2026-02-05T00:00:00.000Z"), extra: undefined };

// `diff()` returns an empty array when there are no changes.
const delta = diff(lhs, rhs);

// Deltas are JSON-safe.
const wire = JSON.stringify(delta);
const parsed = JSON.parse(wire);

const target = structuredClone(lhs);
apply(target, parsed);

// target is now equal to rhs (including Date + explicit undefined).
```

CommonJS:

```js
const { apply, diff } = require("@azuliani/tree-diff");
```

## API

### `diff(lhs, rhs) -> TreeDelta`

Computes a delta that transforms `lhs` into `rhs`.

- Roots must both be containers of the same kind (both arrays or both plain objects), otherwise throws `TreeDiffError("INVALID_ROOT")`.
- Returns an empty array when there are no changes.
- Throws on cycles (`CYCLE_DETECTED`) or unsupported values (`UNSUPPORTED_TYPE`).

### `apply(target, delta) -> void`

Mutates `target` in place.

- Strict: throws if keys/indices don’t exist or preconditions don’t match (`TYPE_MISMATCH`, `PRECONDITION_FAILED`).
- Uses `meta` to restore `Date` and `undefined` in leaf payloads.

## Delta format (wire)

The delta is a list of “entries”, where each entry is either:

- a **leaf** (`new`/`edit`/`delete`), or
- a **node** (a path-compressed trie node that groups shared prefixes).

```ts
type Key = string | number;
type RelPath = Key[];

type Meta = {
  d?: RelPath[]; // Date paths (relative to leaf rhs)
  u?: RelPath[]; // undefined paths (relative to leaf rhs)
};

type Leaf =
  | [key: Key, kind: "D"]
  | [key: Key, kind: "N" | "E", rhs: unknown, meta?: Meta];

type Node = [path: Key[], entries: Entry[]];
type Entry = Leaf | Node;
type TreeDelta = Entry[];
```

## Supported values and constraints

Supported runtime values in `lhs`/`rhs`:

- JSON primitives (`null`, `boolean`, `string`, finite `number`)
- arrays
- **plain objects only** (prototype must be `Object.prototype` or `null`)
- `Date`
- `undefined` (distinct from deletion)

Constraints:

- No root replacement (roots must be containers of the same kind).
- Arrays are index-based with **tail-only** adds/deletes (push/pop semantics).
- Cycles are illegal (diff throws).

## Errors

The library throws `TreeDiffError` with a `code`:

`INVALID_ROOT`, `CYCLE_DETECTED`, `UNSUPPORTED_TYPE`, `TYPE_MISMATCH`, `PRECONDITION_FAILED`,
`INVALID_META`, `INVALID_DATE`, `INVALID_UNDEFINED_ENCODING`.

```ts
import { TreeDiffError } from "@azuliani/tree-diff";

try {
  apply({ a: 1 }, [["a", "D"]]);
} catch (e) {
  if (e instanceof TreeDiffError) {
    console.error(e.code, e.message);
  }
}
```

## Notes

- Performance: if a leaf has no `meta`, `apply()` may reuse the leaf `rhs` reference directly. If you need deltas to stay immutable, don’t mutate the patched payload (or deep-clone it first).
- Full details (normative): see `SPEC.md`.

## Development

```sh
npm test
npm run typecheck
npm run build
```

Benchmarks:

```sh
npm run bench
```
