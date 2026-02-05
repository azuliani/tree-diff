import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

import type { Fixture } from "./fixtures.ts";
import { makeFixtures } from "./fixtures.ts";

type AnyFn = () => void;

type MeasureResult = {
  name: string;
  iterations: number;
  avgUs: number;
  medianUs: number;
  p95Us: number;
  opsPerSec: number;
};

function parseArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith("--")) return undefined;
  return v;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function run(cmd: string, args: string[], cwd: string): void {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function measure(name: string, fn: AnyFn, iterations: number, warmup: number): MeasureResult {
  for (let i = 0; i < warmup; i++) fn();

  if (globalThis.gc) globalThis.gc();

  const timesNs: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    fn();
    const end = process.hrtime.bigint();
    timesNs.push(Number(end - start));
  }

  timesNs.sort((a, b) => a - b);
  const total = timesNs.reduce((a, b) => a + b, 0);
  const avg = total / iterations;
  const median = timesNs[Math.floor(iterations / 2)]!;
  const p95 = timesNs[Math.floor(iterations * 0.95)]!;

  return {
    name,
    iterations,
    avgUs: avg / 1_000,
    medianUs: median / 1_000,
    p95Us: p95 / 1_000,
    opsPerSec: Math.round(1e9 / avg),
  };
}

function formatResult(r: MeasureResult): string {
  return [
    r.name.padEnd(34),
    `${r.opsPerSec.toLocaleString().padStart(10)} ops/s`,
    `avg: ${r.avgUs.toFixed(2).padStart(8)} us`,
    `median: ${r.medianUs.toFixed(2).padStart(8)} us`,
    `p95: ${r.p95Us.toFixed(2).padStart(8)} us`,
  ].join("  |  ");
}

function jsonBytes(value: unknown): number {
  if (value === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function fixtureHeader(f: Fixture, sizes: { treeBytes: number; deepBytes: number; deepCount: number }): void {
  console.log(`\n${"=".repeat(120)}`);
  console.log(`  ${f.name}`);
  console.log(
    `  delta bytes (json): tree=${sizes.treeBytes.toLocaleString()}  deep=${sizes.deepBytes.toLocaleString()}  deep-count=${sizes.deepCount.toLocaleString()}`
  );
  console.log("=".repeat(120));
}

function benchForFixture(
  fixture: Fixture,
  libs: {
    tree: { diff: (a: unknown, b: unknown) => unknown; apply: (t: any, d: any) => void };
    deep: { diff: (a: unknown, b: unknown) => unknown; applyDiff: (t: any, d: any) => void };
  },
  cfg: { iterations: number; warmup: number; wire: boolean }
): void {
  const { tree, deep } = libs;
  const lhs = fixture.lhs;
  const rhs = fixture.rhs;

  // Precompute deltas for byte-size stats
  const treeF = tree.diff(lhs, rhs);
  const deepF = deep.diff(lhs, rhs);
  const deepCount = Array.isArray(deepF) ? deepF.length : 0;
  fixtureHeader(fixture, {
    treeBytes: jsonBytes(treeF),
    deepBytes: jsonBytes(deepF),
    deepCount,
  });

  type PreparedLib = {
    ok: true;
    diff: (a: unknown, b: unknown) => unknown;
    apply: (t: any, d: any) => void;
    forward: unknown;
    backward: unknown;
    target: any;
    label: string;
  } | { ok: false; label: string; reason: string };

  const prepare = (label: string, diffFn: (a: unknown, b: unknown) => unknown, applyFn: (t: any, d: any) => void): PreparedLib => {
    try {
      const forward = diffFn(lhs, rhs);
      const backward = diffFn(rhs, lhs);

      const wireForward = cfg.wire ? (forward ? JSON.parse(JSON.stringify(forward)) : forward) : forward;
      const wireBackward = cfg.wire ? (backward ? JSON.parse(JSON.stringify(backward)) : backward) : backward;

      // Sanity check once (semantic correctness)
      const t: any = structuredClone(lhs);
      applyFn(t, wireForward);
      assert.deepStrictEqual(t, rhs);
      applyFn(t, wireBackward);
      assert.deepStrictEqual(t, lhs);

      return {
        ok: true,
        label,
        diff: diffFn,
        apply: applyFn,
        forward: wireForward,
        backward: wireBackward,
        target: structuredClone(lhs),
      };
    } catch (e) {
      if (e instanceof assert.AssertionError) {
        return { ok: false, label, reason: "roundtrip mismatch (semantic incompatibility)" };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, label, reason: msg };
    }
  };

  const results: MeasureResult[] = [];

  const treePrepared = prepare("tree-diff", tree.diff, tree.apply);
  const deepPrepared = prepare("deep-diff", deep.diff, deep.applyDiff);

  if (treePrepared.ok) {
    results.push(measure("tree-diff diff", () => void treePrepared.diff(lhs, rhs), cfg.iterations, cfg.warmup));
    results.push(
      measure(
        cfg.wire ? "tree-diff apply (wire RT)" : "tree-diff apply (RT)",
        () => {
          treePrepared.apply(treePrepared.target, treePrepared.forward);
          treePrepared.apply(treePrepared.target, treePrepared.backward);
        },
        cfg.iterations,
        cfg.warmup
      )
    );
  } else {
    console.log(`tree-diff: SKIP (${treePrepared.reason})`);
  }

  if (deepPrepared.ok) {
    results.push(measure("deep-diff diff", () => void deepPrepared.diff(lhs, rhs), cfg.iterations, cfg.warmup));
    results.push(
      measure(
        cfg.wire ? "deep-diff apply (wire RT)" : "deep-diff apply (RT)",
        () => {
          deepPrepared.apply(deepPrepared.target, deepPrepared.forward);
          deepPrepared.apply(deepPrepared.target, deepPrepared.backward);
        },
        cfg.iterations,
        cfg.warmup
      )
    );
  } else {
    console.log(`deep-diff: SKIP (${deepPrepared.reason})`);
  }

  for (const r of results) console.log(formatResult(r));
}

const deepDiffDir =
  parseArgValue("--deep-diff-dir") ??
  process.env.DEEP_DIFF_DIR ??
  path.join(os.homedir(), "Work", "deep-diff");

const iterations = Number(parseArgValue("--iterations") ?? process.env.BENCH_ITERATIONS ?? "1000");
const warmup = Number(parseArgValue("--warmup") ?? process.env.BENCH_WARMUP ?? "200");

if (!Number.isFinite(iterations) || iterations <= 0) {
  console.error("Invalid --iterations");
  process.exit(1);
}
if (!Number.isFinite(warmup) || warmup < 0) {
  console.error("Invalid --warmup");
  process.exit(1);
}

const wire = hasFlag("--wire") || process.env.BENCH_WIRE === "1";
const noBuild = hasFlag("--no-build");
const only = parseArgValue("--only");

console.log(`Node: ${process.version}`);
console.log(`Iterations: ${iterations}  Warmup: ${warmup}  Wire: ${wire ? "yes" : "no"}  GC: ${globalThis.gc ? "enabled" : "disabled"}`);
console.log(`deep-diff dir: ${deepDiffDir}`);

if (!noBuild) {
  run("npm", ["run", "build"], process.cwd());
  run("npm", ["run", "build"], deepDiffDir);
}

const treeUrl = pathToFileURL(path.join(process.cwd(), "dist", "esm", "index.js")).href;
const deepUrl = pathToFileURL(path.join(deepDiffDir, "dist", "esm", "index.js")).href;

const treeMod = (await import(treeUrl)) as unknown as {
  diff: (a: unknown, b: unknown) => unknown;
  apply: (t: any, d: any) => void;
};
const deepMod = (await import(deepUrl)) as unknown as {
  diff: (a: unknown, b: unknown) => unknown;
  applyDiff: (t: any, d: any) => void;
};

const fixtures = makeFixtures();
for (const f of fixtures) {
  if (only && !f.name.includes(only)) continue;
  benchForFixture(
    f,
    { tree: treeMod, deep: deepMod },
    { iterations, warmup, wire }
  );
}
