/**
 * Task metadata utility functions.
 *
 * Pure functions for interpreting task pack metadata.
 * Extracted from app.js for independent testability.
 */

/**
 * Extract task intent summary from task metadata.
 */
export function taskIntentSummary(task) {
  const objective = task.metadata?.objective ?? task.description ?? "";
  const rationale = task.metadata?.judgeRationale ?? "";
  const repoTypes = task.metadata?.repoTypes?.length ? task.metadata.repoTypes.join(", ") : "generic";
  return { objective, rationale, repoTypes };
}

/**
 * Get baseline task warning text.
 * @param {Function} t - i18n translate function
 */
export function baselineTaskWarning(task, t) {
  if (task.id === "official-repo-health" || task.id === "repo-health") {
    return t("baselineWarning");
  }
  return t("generalWarning");
}

/**
 * Get task meaning badges.
 * @param {Function} t - i18n translate function
 */
export function taskMeaningBadges(task, t) {
  if (task.id === "official-repo-health" || task.id === "repo-health") {
    return [
      t("baselineSanityCheck"),
      t("notACodeReview"),
      t("notABugfixBenchmark")
    ];
  }
  return [t("interpretThroughGoal")];
}

/**
 * Summarize task prompt to a compact string (max 160 chars).
 */
export function summarizeTaskPrompt(prompt) {
  const compact = String(prompt ?? "")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (!compact) {
    return "n/a";
  }
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

/**
 * Summarize judges from a task pack.
 * @param {Function} t - i18n translate function
 */
export function summarizeJudges(taskPack, t) {
  const judges = Array.isArray(taskPack?.judges) ? taskPack.judges : [];
  if (judges.length === 0) {
    return t("noJudges");
  }
  const labels = judges.map((judge) => judge.label || judge.id).filter(Boolean);
  const summary = labels.slice(0, 3).join(", ");
  if (labels.length <= 3) {
    return summary;
  }
  return t("judgesSummary", summary, labels.length);
}

/**
 * Format judge type to localized label.
 * @param {Function} t - i18n translate function
 */
export function formatJudgeType(type, t) {
  const typeMap = {
    "test-result": "judgeTestResult",
    "lint-check": "judgeLintCheck",
    "file-exists": "judgeFileExists",
    "file-contains": "judgeFileContains",
    "json-value": "judgeJsonValue",
    glob: "judgeGlob",
    "file-count": "judgeFileCount",
    snapshot: "judgeSnapshot",
    "json-schema": "judgeJsonSchema",
    "patch-validation": "judgePatchValidation",
    "token-efficiency": "judgeTokenEfficiency"
  };
  return t(typeMap[type] || "judgeCommand");
}

/**
 * Translate difficulty level.
 * @param {Function} t - i18n translate function
 */
export function translateDifficulty(d, t) {
  if (!d) return "";
  const map = { easy: t("difficultyEasy"), medium: t("difficultyMedium"), hard: t("difficultyHard") };
  return map[d] || d;
}

/**
 * Translate run status.
 * @param {Function} t - i18n translate function
 */
export function translateStatus(s, t) {
  if (s === "success") return t("compareStatusSuccess");
  if (s === "failed") return t("compareStatusFailed");
  if (s === "timeout") return t("compareStatusTimeout");
  if (s === "error") return t("compareStatusError");
  if (s === "skipped") return t("compareStatusSkipped");
  return s || t("compareStatusUnknown");
}

/**
 * Get CSS class for a status value.
 */
export function statusClass(status) {
  return `status-${status || "unknown"}`;
}
