export type Key = string | number;

export type RelPath = Key[];

export type Meta = {
  /** Date paths within rhs (relative to rhs). */
  d?: RelPath[];
  /** Undefined paths within rhs (relative to rhs). */
  u?: RelPath[];
};

export type Leaf =
  | [key: Key, kind: "D"]
  | [key: Key, kind: "N" | "E", rhs: unknown, meta?: Meta];

export type Node = [path: Key[], entries: Entry[]];

export type Entry = Leaf | Node;

export type TreeDelta = Entry[];

