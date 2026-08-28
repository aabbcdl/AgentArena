export function isQualifiedResult(result: unknown): boolean;
export function getQualifiedResults<T>(results: readonly T[]): T[];
export function deriveEvaluationStatus(
  totalResults: number,
  qualifiedResults: number,
  options?: { damaged?: boolean }
): "pass" | "partial" | "fail" | "incomplete";
