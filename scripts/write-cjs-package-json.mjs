import fs from "node:fs/promises";
import path from "node:path";

const cjsDir = path.join(process.cwd(), "dist", "cjs");
await fs.mkdir(cjsDir, { recursive: true });

const pkgPath = path.join(cjsDir, "package.json");
await fs.writeFile(pkgPath, JSON.stringify({ type: "commonjs" }, null, 2) + "\n", "utf8");

