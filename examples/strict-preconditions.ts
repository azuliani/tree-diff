import { apply, diff, TreeDiffError } from "../src/index.ts";

const lhs = { a: 1 };
const rhs = { a: 2 };
const delta = diff(lhs, rhs);

try {
  apply({ a: 999 }, delta);
  console.log("unexpected: patch applied");
} catch (e) {
  if (e instanceof TreeDiffError) {
    console.log(`apply() failed as expected: ${e.code}${e.message ? ` (${e.message})` : ""}`);
  } else {
    throw e;
  }
}

