// Strictness demo:
// - apply() throws if patch existence/index preconditions don't match the target
// - demonstrates PRECONDITION_FAILED
import { apply, diff, TreeDiffError } from "../src/index.ts";

const lhs = { a: 1 };
const rhs = { a: 2 };
const delta = diff(lhs, rhs);

try {
  apply({}, delta);
  console.log("unexpected: patch applied");
} catch (e) {
  if (e instanceof TreeDiffError) {
    console.log(`apply() failed as expected: ${e.code}${e.message !== e.code ? ` (${e.message})` : ""}`);
  } else {
    throw e;
  }
}
