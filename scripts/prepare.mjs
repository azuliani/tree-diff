import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const required = [
  path.join(process.cwd(), "dist", "esm", "index.js"),
  path.join(process.cwd(), "dist", "cjs", "index.js"),
  path.join(process.cwd(), "dist", "cjs", "package.json"),
  path.join(process.cwd(), "dist", "types", "index.d.ts"),
];

if (required.every((p) => fs.existsSync(p))) {
  process.exit(0);
}

const res = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
process.exit(res.status ?? 1);
