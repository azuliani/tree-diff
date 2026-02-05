export type TreeDiffErrorCode =
  | "INVALID_ROOT"
  | "CYCLE_DETECTED"
  | "UNSUPPORTED_TYPE"
  | "TYPE_MISMATCH"
  | "PRECONDITION_FAILED"
  | "INVALID_META"
  | "INVALID_DATE"
  | "INVALID_UNDEFINED_ENCODING";

export class TreeDiffError extends Error {
  readonly code: TreeDiffErrorCode;

  constructor(code: TreeDiffErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "TreeDiffError";
  }
}

