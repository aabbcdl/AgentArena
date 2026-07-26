export function isQualifiedResult(result) {
  // The persisted result status is the canonical execution/evaluation verdict.
  // Judge details explain that verdict but must not create a second, divergent
  // qualification rule in either frontend.
  return result?.status === "success" && result?.scoreExcluded !== true;
}

export function getQualifiedResults(results) {
  return Array.isArray(results) ? results.filter(isQualifiedResult) : [];
}

export function deriveEvaluationStatus(totalResults, qualifiedResults, options = {}) {
  if (options.damaged === true || totalResults === 0) return "incomplete";
  if (qualifiedResults === totalResults) return "pass";
  if (qualifiedResults > 0) return "partial";
  return "fail";
}
