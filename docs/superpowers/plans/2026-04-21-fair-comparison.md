# Fair Comparison in Web Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the web report only builds primary comparison conclusions from fairly comparable results, while keeping excluded results visible with explicit reasons.

**Architecture:** Add small fairness metadata to exported run summaries, then centralize fair-comparison eligibility in the web-report view model. Drive the dashboard and cross-run comparison surfaces through that shared filter so primary rankings, empty states, and exclusion messaging all come from one deterministic rule set.

**Tech Stack:** pnpm monorepo, Node.js, TypeScript in packages, vanilla JS SPA in `apps/web-report`, Node test runner, Playwright smoke tests

---

## File Structure

### Files to modify

- `packages/core/src/types.ts`
  - Extend the serialized benchmark run shape with optional fairness identity metadata that the report can consume without guessing.
- `packages/cli/src/output.ts`
  - Include the new fairness metadata in `summary.json` output.
- `apps/web-report/src/view-model.js`
  - Add the fair-comparison eligibility helpers, exclusion reason generation, and filtered row builders used by the report UI.
- `apps/web-report/src/report/dashboard.js`
  - Update the main run comparison rendering so the primary table and empty states use only fairly comparable results and display excluded results separately.
- `apps/web-report/src/report/cross-run.js`
  - Replace the current “different task only” exclusion with the full fairness-rule explanation.
- `apps/web-report/src/i18n.js`
  - Add the user-facing strings for the fairness-only comparison copy, edge states, and exclusion reasons.
- `tests/web-report-loaders.test.mjs`
  - Add view-model level fixtures covering summary metadata and fairness filtering behavior.
- `tests/web-report.e2e.mjs`
  - Add a browser smoke fixture that verifies the fair-comparison UI text and excluded-results section render correctly.

### Files to inspect while implementing

- `packages/report/src/leaderboard.ts`
  - Reuse the existing idea of stable comparability identity instead of inventing new ad hoc matching.
- `apps/web-report/src/app.js`
  - Confirm which DOM anchors already exist and whether the dashboard renderer needs new element handles.
- `docs/superpowers/specs/2026-04-21-fair-comparison-design.md`
  - Keep the implementation aligned with the approved spec.

### New files to create

- None unless the current dashboard markup proves too tangled; prefer keeping the fairness logic in `view-model.js` and the rendering updates in existing report modules.

---

### Task 1: Add fairness metadata to exported run summaries

**Files:**
- Modify: `packages/core/src/types.ts:559-571`
- Modify: `packages/cli/src/output.ts:22-66`
- Test: `tests/web-report-loaders.test.mjs`

- [ ] **Step 1: Write the failing test for serialized fairness metadata**

Add a test near the loader/output fixtures that asserts a serialized run can carry the new fairness fields:

```js
test("summary fixtures can include fair comparison metadata", () => {
  const summary = {
    runId: "run-1",
    createdAt: "2026-04-21T00:00:00.000Z",
    fairComparison: {
      taskIdentity: "task:test-task",
      judgeIdentity: "judge:abc123",
      repoBaselineIdentity: "repo:def456"
    },
    task: {
      id: "test-task",
      title: "Test Task",
      schemaVersion: "agentarena.taskpack/v1"
    },
    results: []
  };

  assert.equal(summary.fairComparison.taskIdentity, "task:test-task");
  assert.equal(summary.fairComparison.judgeIdentity, "judge:abc123");
  assert.equal(summary.fairComparison.repoBaselineIdentity, "repo:def456");
});
```

- [ ] **Step 2: Run the targeted test file to verify the fixture is currently not represented in typed output**

Run: `pnpm test -- --test-name-pattern="summary fixtures can include fair comparison metadata"`
Expected: FAIL or no matching coverage proving the metadata path does not exist yet.

- [ ] **Step 3: Extend the core run type with optional fair-comparison metadata**

Update `BenchmarkRun` in `packages/core/src/types.ts` to carry an optional metadata object:

```ts
export interface FairComparisonMetadata {
  taskIdentity?: string;
  judgeIdentity?: string;
  repoBaselineIdentity?: string;
}

export interface BenchmarkRun {
  runId: string;
  createdAt: string;
  repoPath: string;
  outputPath: string;
  scoreMode?: string;
  scoreWeights?: Record<string, number>;
  scoreScope?: "run-local";
  scoreValidityNote?: string;
  fairComparison?: FairComparisonMetadata;
  task: TaskPack;
  preflights: AdapterPreflightResult[];
  results: AgentRunResult[];
}
```

- [ ] **Step 4: Populate deterministic metadata in CLI summary output**

Update `buildBenchmarkOutputSummary()` in `packages/cli/src/output.ts` to emit the metadata using existing task information and a stable judge fingerprint placeholder derived from the current task shape:

```ts
import { createHash } from "node:crypto";

function createJudgeIdentity(task: BenchmarkRun["task"]): string {
  const payload = JSON.stringify(
    task.judges.map((judge) => ({
      id: judge.id,
      type: judge.type,
      label: judge.label,
      critical: judge.critical ?? false
    }))
  );
  return `judge:${createHash("sha256").update(payload).digest("hex")}`;
}

function createTaskIdentity(task: BenchmarkRun["task"]): string {
  return task.id ? `task:${task.id}` : `task-title:${task.title}`;
}

function createRepoBaselineIdentity(benchmark: BenchmarkRun): string | undefined {
  const baseCommit = benchmark.task.metadata?.githubIssue?.baseCommit;
  if (baseCommit) {
    return `repo-base:${baseCommit}`;
  }
  return undefined;
}
```

Then include:

```ts
fairComparison: {
  taskIdentity: createTaskIdentity(scoredBenchmark.task),
  judgeIdentity: createJudgeIdentity(scoredBenchmark.task),
  repoBaselineIdentity: createRepoBaselineIdentity(scoredBenchmark)
},
```

- [ ] **Step 5: Re-run the targeted test to verify the new metadata shape passes**

Run: `pnpm test -- --test-name-pattern="summary fixtures can include fair comparison metadata"`
Expected: PASS

- [ ] **Step 6: Commit the metadata slice**

```bash
git add packages/core/src/types.ts packages/cli/src/output.ts tests/web-report-loaders.test.mjs
git commit -m "feat: add fair comparison metadata to summaries"
```

---

### Task 2: Build deterministic fair-comparison eligibility helpers in the view model

**Files:**
- Modify: `apps/web-report/src/view-model.js:192-216`
- Modify: `apps/web-report/src/view-model.js:462-521`
- Test: `tests/web-report-loaders.test.mjs`

- [ ] **Step 1: Write failing view-model tests for fair-comparison eligibility**

Add focused tests that describe the new rules:

```js
test("getRunCompareRows excludes runs with different repo baseline identities", () => {
  const currentRun = createRunFixture({
    runId: "run-a",
    fairComparison: {
      taskIdentity: "task:test-task",
      judgeIdentity: "judge:shared",
      repoBaselineIdentity: "repo:111"
    }
  });
  const differentBaselineRun = createRunFixture({
    runId: "run-b",
    fairComparison: {
      taskIdentity: "task:test-task",
      judgeIdentity: "judge:shared",
      repoBaselineIdentity: "repo:222"
    }
  });

  const data = getRunCompareRows([currentRun, differentBaselineRun], {
    currentRunId: "run-a",
    markdownByRunId: new Map()
  });

  assert.equal(data.comparableRows.length, 1);
  assert.equal(data.excludedRows[0].reasons[0], "different-repo-baseline");
});

test("getRunCompareRows excludes runs missing core fairness data", () => {
  const currentRun = createRunFixture({
    runId: "run-a",
    fairComparison: {
      taskIdentity: "task:test-task",
      judgeIdentity: "judge:shared",
      repoBaselineIdentity: "repo:111"
    }
  });
  const incompleteRun = createRunFixture({
    runId: "run-c",
    fairComparison: {
      taskIdentity: "task:test-task",
      judgeIdentity: "judge:shared"
    }
  });

  const data = getRunCompareRows([currentRun, incompleteRun], {
    currentRunId: "run-a",
    markdownByRunId: new Map()
  });

  assert.equal(data.excludedRows[0].reasons[0], "missing-core-data");
});
```

- [ ] **Step 2: Run the targeted view-model tests to verify they fail**

Run: `pnpm test -- --test-name-pattern="getRunCompareRows excludes runs"`
Expected: FAIL because `getRunCompareRows()` still returns a flat array.

- [ ] **Step 3: Add shared fairness helpers in `view-model.js`**

Create small helpers close to the current `taskIdentity()` / `areRunsComparable()` logic:

```js
function fairComparisonIdentity(run) {
  return {
    taskIdentity: run.fairComparison?.taskIdentity ?? taskIdentity(run),
    judgeIdentity: run.fairComparison?.judgeIdentity ?? null,
    repoBaselineIdentity: run.fairComparison?.repoBaselineIdentity ?? null
  };
}

function missingCoreComparisonData(run) {
  if (!run?.results?.length) return true;
  return run.results.some((result) => {
    const hasStatus = typeof result.status === "string" && result.status.length > 0;
    const hasJudgeResults = Array.isArray(result.judgeResults);
    const hasScoreInputs = typeof result.durationMs === "number" && typeof result.tokenUsage === "number";
    return !hasStatus || !hasJudgeResults || !hasScoreInputs;
  });
}

function getFairComparisonExclusionReasons(candidateRun, anchorRun) {
  const candidate = fairComparisonIdentity(candidateRun);
  const anchor = fairComparisonIdentity(anchorRun);
  const reasons = [];

  if (!candidate.taskIdentity || candidate.taskIdentity !== anchor.taskIdentity) {
    reasons.push("different-task-pack");
  }
  if (!candidate.judgeIdentity || candidate.judgeIdentity !== anchor.judgeIdentity) {
    reasons.push("different-judge-logic");
  }
  if (!candidate.repoBaselineIdentity || candidate.repoBaselineIdentity !== anchor.repoBaselineIdentity) {
    reasons.push("different-repo-baseline");
  }
  if (missingCoreComparisonData(candidateRun)) {
    reasons.push("missing-core-data");
  }

  return reasons;
}
```

- [ ] **Step 4: Change `getRunCompareRows()` to return comparable and excluded rows**

Refactor the function to anchor on the selected/current run instead of returning a single flat array:

```js
export function getRunCompareRows(runs, options = {}) {
  const taskTitle = options.taskTitle ?? null;
  const sort = options.sort ?? "created";
  const markdownByRunId = options.markdownByRunId ?? new Map();
  const currentRunId = options.currentRunId ?? null;
  const filteredRuns = runs.filter((run) => !taskTitle || run.task.title === taskTitle);
  const anchorRun = filteredRuns.find((run) => run.runId === currentRunId) ?? filteredRuns[0] ?? null;

  if (!anchorRun) {
    return { anchorRun: null, comparableRows: [], excludedRows: [] };
  }

  const comparableRows = [];
  const excludedRows = [];

  for (const run of filteredRuns) {
    const row = {
      run,
      summary: summarizeRun(run),
      hasMarkdown: markdownByRunId.has(run.runId)
    };
    const reasons = run.runId === anchorRun.runId ? [] : getFairComparisonExclusionReasons(run, anchorRun);
    if (reasons.length === 0) {
      comparableRows.push(row);
    } else {
      excludedRows.push({ ...row, reasons });
    }
  }

  return {
    anchorRun,
    comparableRows: comparableRows.sort((left, right) => compareRunRows(sort, left, right)),
    excludedRows: excludedRows.sort((left, right) => right.run.createdAt.localeCompare(left.run.createdAt))
  };
}
```

Add a small `compareRunRows()` helper that reuses the existing `runCompareSortValue()` logic.

- [ ] **Step 5: Update the cross-run comparer to use the same exclusion reasons**

Refactor `getCrossRunCompareRows()` to reuse `getFairComparisonExclusionReasons()` so that cross-run and dashboard views never drift.

```js
const excludedRuns = selectedRuns
  .map((run) => ({ run, reasons: getFairComparisonExclusionReasons(run, anchorRun) }))
  .filter((entry) => entry.reasons.length > 0);
```

- [ ] **Step 6: Re-run the targeted view-model tests to verify the eligibility logic passes**

Run: `pnpm test -- --test-name-pattern="getRunCompareRows excludes runs"`
Expected: PASS

- [ ] **Step 7: Commit the view-model logic slice**

```bash
git add apps/web-report/src/view-model.js tests/web-report-loaders.test.mjs
git commit -m "feat: add fair comparison filtering logic"
```

---

### Task 3: Update dashboard UI to show fair-only primary comparison and excluded runs

**Files:**
- Modify: `apps/web-report/src/report/dashboard.js:181-228`
- Modify: `apps/web-report/src/app.js:133-186`
- Modify: `apps/web-report/src/i18n.js`
- Test: `tests/web-report.e2e.mjs`

- [ ] **Step 1: Write the failing browser smoke test for fair-only comparison copy**

Add a fixture with one comparable run and one excluded run, then assert the dashboard labels and exclusion reasons:

```js
test("run compare separates excluded runs from fair comparison", {
  timeout: 120000
}, async (t) => {
  const chromium = await loadChromiumOrSkip(t);
  if (!chromium) return;
  const cwd = path.resolve(".");
  const uiServer = await startUiServer(cwd);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  try {
    await page.goto(`http://127.0.0.1:${uiServer.port}/`, { waitUntil: "networkidle", timeout: 30000 });
    await injectRunFolder(page, createFairnessFixtureRuns());
    await page.waitForFunction(() => document.body.innerText.includes("Only fairly comparable runs are ranked here"));

    const body = await page.locator("body").innerText();
    assert.match(body, /Only fairly comparable runs are ranked here/);
    assert.match(body, /Excluded from fair comparison/);
    assert.match(body, /different repository baseline/i);
  } finally {
    await browser.close();
    await uiServer.stop();
  }
});
```

- [ ] **Step 2: Run the browser smoke test to verify the new copy is absent**

Run: `AGENTARENA_RUN_BROWSER_SMOKE=1 pnpm test -- --test-name-pattern="run compare separates excluded runs from fair comparison"`
Expected: FAIL because the dashboard still renders a single flat table.

- [ ] **Step 3: Add i18n strings for fair-only comparison and exclusion reasons**

Add concise keys in `apps/web-report/src/i18n.js` for both locales:

```js
runCompareFairOnlyTitle: "Fair Comparison",
runCompareFairOnlyDescription: "Only fairly comparable runs are ranked here.",
runCompareSingleComparable: "Only one fairly comparable run is available.",
runCompareNoComparable: "No runs met the fairness rules for direct comparison.",
runCompareExcludedTitle: "Excluded from Fair Comparison",
runCompareExcludedDescription: "These runs stay visible, but they do not affect the main ranking.",
runCompareReasonDifferentTaskPack: "Used a different task pack.",
runCompareReasonDifferentJudgeLogic: "Used different judge logic.",
runCompareReasonDifferentRepoBaseline: "Used a different repository baseline.",
runCompareReasonMissingCoreData: "Missing key comparison data."
```

- [ ] **Step 4: Update `renderRunCompareTable()` to consume the new structured rows**

Change the dashboard renderer to handle `comparableRows` and `excludedRows` separately:

```js
const { comparableRows, excludedRows } = getRunCompareRows(state.runs, {
  currentRunId: state.selectedRunId,
  taskTitle,
  sort: runCompareFilters.sort,
  markdownByRunId: state.markdownByRunId
});

if (comparableRows.length === 0) {
  elements.runCompareTable.innerHTML = `<p class="empty-state">${escapeHtml(t("runCompareNoComparable"))}</p>${renderExcludedRuns(excludedRows)}`;
  return;
}

const summaryText = comparableRows.length === 1
  ? t("runCompareSingleComparable")
  : t("runCompareFairOnlyDescription");
```

Render the main table from `comparableRows` only, then append a second block like:

```js
function renderExcludedRuns(excludedRows) {
  if (excludedRows.length === 0) return "";
  return `
    <section class="compare-excluded-block">
      <h4>${escapeHtml(t("runCompareExcludedTitle"))}</h4>
      <p class="muted">${escapeHtml(t("runCompareExcludedDescription"))}</p>
      <ul class="compare-excluded-list">
        ${excludedRows.map((row) => `
          <li>
            <strong>${escapeHtml(row.run.task.title)}</strong>
            <code>${escapeHtml(row.run.runId)}</code>
            <p>${escapeHtml(row.reasons.map((reason) => translateFairComparisonReason(reason, t)).join(" "))}</p>
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}
```

- [ ] **Step 5: Add a tiny translation helper instead of duplicating string switching inline**

Near the dashboard renderer, add:

```js
function translateFairComparisonReason(reason, t) {
  switch (reason) {
    case "different-task-pack":
      return t("runCompareReasonDifferentTaskPack");
    case "different-judge-logic":
      return t("runCompareReasonDifferentJudgeLogic");
    case "different-repo-baseline":
      return t("runCompareReasonDifferentRepoBaseline");
    case "missing-core-data":
    default:
      return t("runCompareReasonMissingCoreData");
  }
}
```

- [ ] **Step 6: Re-run the browser smoke test to verify the new fair-comparison UI passes**

Run: `AGENTARENA_RUN_BROWSER_SMOKE=1 pnpm test -- --test-name-pattern="run compare separates excluded runs from fair comparison"`
Expected: PASS

- [ ] **Step 7: Commit the dashboard slice**

```bash
git add apps/web-report/src/report/dashboard.js apps/web-report/src/i18n.js tests/web-report.e2e.mjs apps/web-report/src/app.js
git commit -m "feat: separate fair and excluded run comparisons"
```

---

### Task 4: Upgrade cross-run comparison messaging to use the same fairness rules

**Files:**
- Modify: `apps/web-report/src/report/cross-run.js:83-157`
- Modify: `apps/web-report/src/i18n.js`
- Test: `tests/web-report-loaders.test.mjs`

- [ ] **Step 1: Write the failing cross-run summary test for full exclusion reasons**

Add a focused test around the cross-run compare data shape:

```js
test("getCrossRunCompareRows reports all fair-comparison exclusion reasons", () => {
  const selectedRuns = createCrossRunFairnessFixture();
  const data = getCrossRunCompareRows(selectedRuns);

  assert.deepEqual(data.excludedRuns[0].reasons, [
    "different-task-pack",
    "different-judge-logic",
    "different-repo-baseline"
  ]);
});
```

- [ ] **Step 2: Run the targeted cross-run test to verify it fails**

Run: `pnpm test -- --test-name-pattern="getCrossRunCompareRows reports all fair-comparison exclusion reasons"`
Expected: FAIL because exclusions are still reduced to “different task.”

- [ ] **Step 3: Replace the summary copy in `cross-run.js` to reference fairness filtering**

Update the top summary to stop claiming only task mismatches:

```js
elements.crossRunCompareSummary.textContent = excludedRuns.length > 0
  ? localText(
      `已选 ${runs.length} 个运行，其中 ${comparableRuns.length} 个进入公平对比，${excludedRuns.length} 个因前提不一致被排除。`,
      `${comparableRuns.length} of ${runs.length} selected runs are in the fair comparison; ${excludedRuns.length} were excluded because the comparison conditions do not match.`
    )
  : localText(
      `对比 ${runs.length} 个运行，全部满足公平对比条件。`,
      `Comparing ${runs.length} runs; all meet the fair comparison rules.`
    );
```

- [ ] **Step 4: Append exclusion reasons below the cross-run compare table**

Render excluded runs after the table using the same `translateFairComparisonReason()` mapping used by the dashboard, for example:

```js
const excludedHtml = excludedRuns.length === 0
  ? ""
  : `
    <section class="compare-excluded-block">
      <h4>${escapeHtml(t("runCompareExcludedTitle"))}</h4>
      <ul class="compare-excluded-list">
        ${excludedRuns.map(({ run, reasons }) => `
          <li>
            <strong>${escapeHtml(run.task.title)}</strong>
            <code>${escapeHtml(run.runId)}</code>
            <p>${escapeHtml(reasons.map((reason) => translateFairComparisonReason(reason, t)).join(" "))}</p>
          </li>
        `).join("")}
      </ul>
    </section>
  `;

elements.crossRunCompareTable.innerHTML = header + body + "</tbody></table>" + excludedHtml;
```

- [ ] **Step 5: Re-run the targeted cross-run test to verify exclusion reasons now pass through**

Run: `pnpm test -- --test-name-pattern="getCrossRunCompareRows reports all fair-comparison exclusion reasons"`
Expected: PASS

- [ ] **Step 6: Commit the cross-run slice**

```bash
git add apps/web-report/src/report/cross-run.js apps/web-report/src/i18n.js tests/web-report-loaders.test.mjs
git commit -m "feat: apply fair comparison rules to cross-run view"
```

---

### Task 5: Run the full verification pass and clean up copy mismatches

**Files:**
- Modify: any touched files from Tasks 1-4 if verification reveals mismatches
- Test: `tests/web-report-loaders.test.mjs`
- Test: `tests/web-report.e2e.mjs`

- [ ] **Step 1: Run the focused unit tests for the touched loader and view-model coverage**

Run: `pnpm test -- tests/web-report-loaders.test.mjs`
Expected: PASS

- [ ] **Step 2: Run the browser smoke suite for the web report**

Run: `AGENTARENA_RUN_BROWSER_SMOKE=1 pnpm test -- tests/web-report.e2e.mjs`
Expected: PASS (or skip only if Playwright Chromium is unavailable)

- [ ] **Step 3: Run the web-report package build to catch syntax regressions**

Run: `pnpm --filter @agentarena/web-report build`
Expected: PASS with no syntax errors

- [ ] **Step 4: Run the monorepo test command if the targeted checks passed**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit the verified final slice**

```bash
git add packages/core/src/types.ts packages/cli/src/output.ts apps/web-report/src/view-model.js apps/web-report/src/report/dashboard.js apps/web-report/src/report/cross-run.js apps/web-report/src/i18n.js tests/web-report-loaders.test.mjs tests/web-report.e2e.mjs
git commit -m "feat: enforce fair comparison in web report"
```

---

## Self-Review

### Spec coverage

- Strict primary comparison only for fair results → Task 2 and Task 3
- Explicit exclusion reasons → Task 2, Task 3, and Task 4
- Same task pack / judge logic / repo baseline hard gates → Task 1 and Task 2
- Missing core data exclusion → Task 2 and Task 3
- One-result and zero-result edge states → Task 3
- No execution-flow changes → preserved by limiting changes to summary export and report rendering

### Placeholder scan

- No `TODO`, `TBD`, or “handle appropriately” placeholders remain.
- Every code-changing step includes concrete code or a concrete command.

### Type consistency

- `fairComparison` is the single metadata name across `BenchmarkRun`, CLI output, and web-report code.
- Exclusion reason keys are consistently named:
  - `different-task-pack`
  - `different-judge-logic`
  - `different-repo-baseline`
  - `missing-core-data`

---

Plan complete and saved to `docs/superpowers/plans/2026-04-21-fair-comparison.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
