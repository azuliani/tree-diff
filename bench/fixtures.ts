type Rng = () => number;

function mulberry32(seed: number): Rng {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Fixture = {
  name: string;
  lhs: object | unknown[];
  rhs: object | unknown[];
};

function clone<T>(value: T): T {
  // Node 23+ has structuredClone and it preserves Date + undefined.
  // eslint-disable-next-line no-undef
  return structuredClone(value);
}

export function generateFlatObject(size: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < size; i++) obj[`key${i}`] = `value${i}`;
  return obj;
}

export function mutateFlatObject(
  obj: Record<string, unknown>,
  changeRatio = 0.1
): Record<string, unknown> {
  const out = clone(obj);
  const keys = Object.keys(out);
  const numChanges = Math.max(1, Math.floor(keys.length * changeRatio));

  for (let i = 0; i < numChanges; i++) {
    const idx = Math.floor((i * keys.length) / numChanges);
    const k = keys[idx]!;
    out[k] = `${out[k]}_m`;
  }

  if (keys.length > 0) delete out[keys[0]!];
  out["newKey"] = "newValue";
  return out;
}

export function generateNestedObject(
  depth: number,
  breadth: number,
  rng = mulberry32(123)
): Record<string, unknown> {
  if (depth === 0) return { value: Math.floor(rng() * 1_000_000) };
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < breadth; i++) {
    obj[`child${i}`] = generateNestedObject(depth - 1, breadth, rng);
  }
  return obj;
}

export function generateArray(size: number): unknown[] {
  const arr: unknown[] = [];
  for (let i = 0; i < size; i++) {
    arr.push({ id: i, name: `item${i}`, active: i % 2 === 0, score: i });
  }
  return arr;
}

export function mutateArray(
  arr: unknown[],
  opts: { mode: "edit" | "push" | "pop"; changeRatio?: number } = { mode: "edit" }
): unknown[] {
  const out = clone(arr) as any[];
  const mode = opts.mode;
  const ratio = opts.changeRatio ?? 0.05;

  if (mode === "push") {
    out.push({ id: out.length, name: `item${out.length}`, active: true, score: out.length });
    return out;
  }

  if (mode === "pop") {
    if (out.length > 0) out.pop();
    return out;
  }

  const numChanges = Math.max(1, Math.floor(out.length * ratio));
  for (let i = 0; i < numChanges; i++) {
    const idx = Math.floor((i * out.length) / numChanges);
    const item = out[idx];
    if (item && typeof item === "object") {
      item.name = `${item.name}_m`;
      item.score = (item.score ?? 0) + 1;
    }
  }
  return out;
}

export function generateMixedObject(size: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    id: 1,
    name: "test",
    active: true,
    count: 42,
    ratio: 3.14159,
    created: new Date("2024-01-01T00:00:00.000Z"),
    tags: ["a", "b", "c"],
    metadata: { nested: { deep: { value: "found" } } },
    items: [],
  };
  const items = obj.items as unknown[];
  for (let i = 0; i < size; i++) {
    items.push({
      id: i,
      value: `item-${i}`,
      score: i,
      when: new Date(1704067200000 + i * 86_400_000),
    });
  }
  return obj;
}

export function mutateMixedObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out = clone(obj) as any;
  out.active = !out.active;
  out.count = out.count + 1;
  out.metadata.nested.deep.value = `${out.metadata.nested.deep.value}_m`;

  if (Array.isArray(out.items) && out.items.length > 0) {
    const mid = Math.floor(out.items.length / 2);
    out.items[mid].value = `${out.items[mid].value}_m`;
    out.items[mid].score = out.items[mid].score + 1;
    out.items[mid].when = new Date(out.items[mid].when.getTime() + 3_600_000);
  }

  out.newProp = "added";
  delete out.ratio;
  return out;
}

export function generateObjectWithDates(size: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    created: new Date("2020-01-01T00:00:00.000Z"),
    updated: new Date("2024-01-15T12:30:00.000Z"),
    items: [],
  };
  const items = obj.items as unknown[];
  const base = new Date("2024-01-01T00:00:00.000Z").getTime();
  for (let i = 0; i < size; i++) {
    items.push({
      id: i,
      name: `item-${i}`,
      timestamp: new Date(base + i * 86_400_000),
    });
  }
  return obj;
}

export function mutateWithDates(obj: Record<string, unknown>): Record<string, unknown> {
  const out = clone(obj) as any;

  for (const k of Object.keys(out)) {
    if (out[k] instanceof Date) out[k] = new Date(out[k].getTime() + 86_400_000);
  }

  if (Array.isArray(out.items) && out.items.length > 0) {
    const mid = Math.floor(out.items.length / 2);
    out.items[mid].name = `${out.items[mid].name}_m`;
    out.items[mid].timestamp = new Date(out.items[mid].timestamp.getTime() + 86_400_000);
  }

  return out;
}

export function generateObjectWithUndefined(size: number): Record<string, unknown> {
  const obj: Record<string, unknown> = { a: 1, b: undefined, c: null, items: [] };
  const items = obj.items as unknown[];
  for (let i = 0; i < size; i++) {
    items.push({
      id: i,
      maybe: i % 3 === 0 ? undefined : `v${i}`,
      nested: { flag: i % 2 === 0, value: i % 5 === 0 ? undefined : i },
    });
  }
  return obj;
}

export function mutateWithUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out = clone(obj) as any;
  out.b = "now-defined";
  out.c = undefined;

  if (Array.isArray(out.items) && out.items.length > 0) {
    const mid = Math.floor(out.items.length / 2);
    out.items[mid].maybe = undefined;
    out.items[mid].nested.value = undefined;
    out.items[mid].nested.flag = !out.items[mid].nested.flag;
  }
  return out;
}

export function makeFixtures(): Fixture[] {
  return [
    {
      name: "flat/small (10 keys)",
      lhs: generateFlatObject(10),
      rhs: mutateFlatObject(generateFlatObject(10)),
    },
    {
      name: "flat/medium (100 keys)",
      lhs: generateFlatObject(100),
      rhs: mutateFlatObject(generateFlatObject(100)),
    },
    {
      name: "flat/large (1000 keys)",
      lhs: generateFlatObject(1000),
      rhs: mutateFlatObject(generateFlatObject(1000)),
    },
    {
      name: "nested/shallow (d=3,b=3)",
      lhs: generateNestedObject(3, 3),
      rhs: (() => {
        const l = generateNestedObject(3, 3);
        const r = clone(l) as any;
        r.child0.child0.value = (r.child0.child0.value ?? 0) + 1;
        r.child1 = { replaced: true, value: 123 };
        return r;
      })(),
    },
    {
      name: "nested/deep (d=6,b=2)",
      lhs: generateNestedObject(6, 2),
      rhs: (() => {
        const l = generateNestedObject(6, 2);
        const r = clone(l) as any;
        r.child0.child0.child0.child0.child0.value =
          (r.child0.child0.child0.child0.child0.value ?? 0) + 1;
        return r;
      })(),
    },
    {
      name: "nested/wide (d=2,b=10)",
      lhs: generateNestedObject(2, 10),
      rhs: (() => {
        const l = generateNestedObject(2, 10);
        const r = clone(l) as any;
        r.child9.child9.value = (r.child9.child9.value ?? 0) + 1;
        delete r.child0;
        r.newChild = { value: 999 };
        return r;
      })(),
    },
    {
      name: "array/small edit (10 items)",
      lhs: generateArray(10),
      rhs: mutateArray(generateArray(10), { mode: "edit" }),
    },
    {
      name: "array/medium push (100 items)",
      lhs: generateArray(100),
      rhs: mutateArray(generateArray(100), { mode: "push" }),
    },
    {
      name: "array/large pop (1000 items)",
      lhs: generateArray(1000),
      rhs: mutateArray(generateArray(1000), { mode: "pop" }),
    },
    {
      name: "mixed (50 items + dates)",
      lhs: generateMixedObject(50),
      rhs: mutateMixedObject(generateMixedObject(50)),
    },
    {
      name: "dates/medium (100 items)",
      lhs: generateObjectWithDates(100),
      rhs: mutateWithDates(generateObjectWithDates(100)),
    },
    {
      name: "undefined/medium (100 items)",
      lhs: generateObjectWithUndefined(100),
      rhs: mutateWithUndefined(generateObjectWithUndefined(100)),
    },
  ];
}

