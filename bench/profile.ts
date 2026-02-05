import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

import { makeFixtures } from "./fixtures.ts";

type LibChoice = "tree" | "deep" | "both";
type OpChoice = "diff" | "apply" | "both";

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

function pickFixture(only: string | undefined): { name: string; lhs: unknown; rhs: unknown }[] {
  const fixtures = makeFixtures();
  if (!only) return fixtures;
  const filtered = fixtures.filter((f) => f.name.includes(only));
  if (filtered.length === 0) {
    console.error(`No fixture matched --only ${JSON.stringify(only)}.`);
    console.error("Available fixtures:");
    for (const f of fixtures) console.error(`- ${f.name}`);
    process.exit(1);
  }
  return filtered;
}

function wireRoundtrip<T>(value: T): T {
  // Bench harness expects deltas to be JSON-safe.
  return value ? (JSON.parse(JSON.stringify(value)) as T) : value;
}

async function loadTreeDiff(): Promise<{
  diff: (a: unknown, b: unknown) => unknown;
  apply: (t: any, d: any) => void;
}> {
  const url = pathToFileURL(path.join(process.cwd(), "src", "index.ts")).href;
  return (await import(url)) as any;
}

async function loadDeepDiff(deepDiffDir: string): Promise<{
  diff: (a: unknown, b: unknown) => unknown;
  applyDiff: (t: any, d: any) => void;
}> {
  const url = pathToFileURL(path.join(deepDiffDir, "dist", "esm", "index.js")).href;
  return (await import(url)) as any;
}

function warmup(fn: () => void, warmupIterations: number): void {
  for (let i = 0; i < warmupIterations; i++) fn();
}

function loop(fn: () => void, iterations: number): void {
  for (let i = 0; i < iterations; i++) fn();
}

const deepDiffDir =
  parseArgValue("--deep-diff-dir") ??
  process.env.DEEP_DIFF_DIR ??
  path.join(os.homedir(), "Work", "deep-diff");

const iterations = Number(parseArgValue("--iterations") ?? process.env.PROFILE_ITERATIONS ?? "1000000");
const warmupIterations = Number(parseArgValue("--warmup") ?? process.env.PROFILE_WARMUP ?? "10000");

const lib = (parseArgValue("--lib") ?? "both") as LibChoice;
const op = (parseArgValue("--op") ?? "apply") as OpChoice;
const only = parseArgValue("--only");
const wire = hasFlag("--wire") || process.env.PROFILE_WIRE === "1";
const noBuild = hasFlag("--no-build");

if (!Number.isFinite(iterations) || iterations <= 0) {
  console.error("Invalid --iterations");
  process.exit(1);
}
if (!Number.isFinite(warmupIterations) || warmupIterations < 0) {
  console.error("Invalid --warmup");
  process.exit(1);
}
if (lib !== "tree" && lib !== "deep" && lib !== "both") {
  console.error("Invalid --lib (tree|deep|both)");
  process.exit(1);
}
if (op !== "diff" && op !== "apply" && op !== "both") {
  console.error("Invalid --op (diff|apply|both)");
  process.exit(1);
}

console.log(`Node: ${process.version}`);
console.log(`Iterations: ${iterations}  Warmup: ${warmupIterations}  Wire: ${wire ? "yes" : "no"}  GC: ${globalThis.gc ? "enabled" : "disabled"}`);
console.log(`Lib: ${lib}  Op: ${op}  Fixture filter: ${only ? JSON.stringify(only) : "(all)"}`);
console.log(`deep-diff dir: ${deepDiffDir}`);

if (!noBuild) {
  // tree-diff uses src for profiling, but build anyway for parity with bench/run.ts usage.
  run("npm", ["run", "build"], process.cwd());
  run("npm", ["run", "build"], deepDiffDir);
}

const fixtures = pickFixture(only);

const tree = lib === "deep" ? null : await loadTreeDiff();
const deep = lib === "tree" ? null : await loadDeepDiff(deepDiffDir);

for (const f of fixtures) {
  console.log(`\n=== ${f.name} ===`);

  if ((op === "diff" || op === "both") && tree) {
    warmup(() => void tree.diff(f.lhs, f.rhs), warmupIterations);
    if (globalThis.gc) globalThis.gc();
    loop(() => void tree.diff(f.lhs, f.rhs), iterations);
  }

  if ((op === "diff" || op === "both") && deep) {
    warmup(() => void deep.diff(f.lhs, f.rhs), warmupIterations);
    if (globalThis.gc) globalThis.gc();
    loop(() => void deep.diff(f.lhs, f.rhs), iterations);
  }

  if ((op === "apply" || op === "both") && tree) {
    const forward = tree.diff(f.lhs, f.rhs);
    const backward = tree.diff(f.rhs, f.lhs);
    const wf = wire ? wireRoundtrip(forward) : forward;
    const wb = wire ? wireRoundtrip(backward) : backward;

    const target: any = structuredClone(f.lhs);
    tree.apply(target, wf);
    assert.deepStrictEqual(target, f.rhs);
    tree.apply(target, wb);
    assert.deepStrictEqual(target, f.lhs);

    warmup(() => {
      tree.apply(target, wf);
      tree.apply(target, wb);
    }, warmupIterations);

    if (globalThis.gc) globalThis.gc();

    loop(() => {
      tree.apply(target, wf);
      tree.apply(target, wb);
    }, iterations);
  }

  if ((op === "apply" || op === "both") && deep) {
    const forward = deep.diff(f.lhs, f.rhs);
    const backward = deep.diff(f.rhs, f.lhs);
    const wf = wire ? wireRoundtrip(forward) : forward;
    const wb = wire ? wireRoundtrip(backward) : backward;

    const target: any = structuredClone(f.lhs);
    deep.applyDiff(target, wf);
    assert.deepStrictEqual(target, f.rhs);
    deep.applyDiff(target, wb);
    assert.deepStrictEqual(target, f.lhs);

    warmup(() => {
      deep.applyDiff(target, wf);
      deep.applyDiff(target, wb);
    }, warmupIterations);

    if (globalThis.gc) globalThis.gc();

    loop(() => {
      deep.applyDiff(target, wf);
      deep.applyDiff(target, wb);
    }, iterations);
  }
}

