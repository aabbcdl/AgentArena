import { useMemo, useState } from "preact/hooks";
import { EmptyState, formatCost, formatDuration, formatTime, Icon, PageHeader, Section, StatusPill, t } from "../components/ui";
import {
  buildStrictHarnessComparison,
  inspectStrictHarnessSample,
  type StrictHarnessComparison,
  type StrictHarnessExclusionReason,
  type StrictHarnessKind,
  type StrictHarnessSampleResult
} from "../domain/harness-comparison.ts";
import type { NormalizedRun } from "../domain/run.ts";
import { useWorkbench } from "../hooks/useWorkbench";
import type { Locale } from "../types";

function harnessLabel(agentKind: StrictHarnessKind): string {
  return agentKind === "codex" ? "Codex CLI" : "Claude Code";
}

function exclusionLabel(locale: Locale, reason: StrictHarnessExclusionReason): string {
  const labels: Record<StrictHarnessExclusionReason, { "zh-CN": string; en: string }> = {
    "missing-job-manifest": { "zh-CN": "缺少任务清单", en: "Missing JobManifest" },
    "invalid-job-manifest": { "zh-CN": "任务清单无效", en: "Invalid JobManifest" },
    "manifest-not-completed": { "zh-CN": "任务未完整完成", en: "Run not completed" },
    "requires-two-harnesses": { "zh-CN": "不是双 Harness 样本", en: "Not a two-Harness sample" },
    "different-harness-required": { "zh-CN": "需要 Codex 与 Claude", en: "Requires Codex and Claude" },
    "unknown-model-identity": { "zh-CN": "模型身份未知", en: "Unknown model identity" },
    "different-model": { "zh-CN": "规范模型不同", en: "Different canonical model" },
    "different-provider-policy": { "zh-CN": "Provider 策略不同", en: "Different Provider policy" },
    "different-model-parameters": { "zh-CN": "模型参数不同", en: "Different model parameters" },
    "harness-drift": { "zh-CN": "运行期间 Harness 发生变化", en: "Harness changed during the run" },
    "missing-result": { "zh-CN": "缺少对应结果", en: "Missing variant result" },
    "damaged-result": { "zh-CN": "结果产物损坏", en: "Damaged result" },
    "different-task": { "zh-CN": "任务不同", en: "Different task" },
    "different-repo-baseline": { "zh-CN": "仓库基线不同", en: "Different repository baseline" },
    "different-judge-logic": { "zh-CN": "裁判逻辑不同", en: "Different judge logic" },
    "different-score-mode": { "zh-CN": "评分模式不同", en: "Different score mode" }
  };
  return labels[reason][locale];
}

function resultStatus(locale: Locale, entry: StrictHarnessSampleResult): string {
  if (entry.result.status === "success" && !entry.result.scoreExcluded) return locale === "zh-CN" ? "合格" : "Qualified";
  if (entry.result.status === "cancelled") return locale === "zh-CN" ? "已取消" : "Cancelled";
  return locale === "zh-CN" ? "未合格" : "Not qualified";
}

function resultTone(entry: StrictHarnessSampleResult): "success" | "warning" | "danger" {
  if (entry.result.status === "success" && !entry.result.scoreExcluded) return "success";
  return entry.result.status === "cancelled" ? "warning" : "danger";
}

function shortIdentity(value: string): string {
  if (value.length <= 24) return value;
  return `${value.slice(0, 10)}…${value.slice(-10)}`;
}

function conclusionCopy(locale: Locale, comparison: StrictHarnessComparison): { title: string; detail: string; tone: "success" | "warning" | "info" } {
  const { conclusion, rows } = comparison;
  const declaredIdentity = comparison.samples.some((sample) => sample.modelIdentityEvidence === "declared");
  const evidenceQualifier = declaredIdentity
    ? (locale === "zh-CN" ? "模型身份来自 Profile 声明，未被运行时独立确认。" : "The model identity comes from Profile declarations and was not independently confirmed at runtime.")
    : "";
  if (conclusion.scope === "no-valid-samples") {
    return {
      title: locale === "zh-CN" ? "还没有可用于同模型 Harness 对比的结果" : "No valid same-model Harness comparison yet",
      detail: locale === "zh-CN"
        ? "需要同一次任务中的 Codex 与 Claude，且所有冻结身份一致、模型身份明确、运行后无 Harness 漂移。"
        : "A valid sample needs Codex and Claude in the same run, matching frozen identities, a known model identity, and no post-run Harness drift.",
      tone: "warning"
    };
  }
  if (!conclusion.winnerAgentKind) {
    return {
      title: conclusion.scope === "single-run"
        ? (locale === "zh-CN" ? "本次任务两种 Harness 结果持平" : "The two Harnesses tied on this task")
        : (locale === "zh-CN" ? `${conclusion.sampleCount} 次有效样本未形成明确胜者` : `${conclusion.sampleCount} valid samples produced no clear winner`),
      detail: conclusion.scope === "single-run"
        ? `${locale === "zh-CN" ? "这是单次任务结论，不代表普遍能力。" : "This is a single-task result, not a general capability claim."}${evidenceQualifier ? ` ${evidenceQualifier}` : ""}`
        : `${locale === "zh-CN" ? "胜负次数相同或样本全部持平。" : "Win counts are equal or every sample tied."}${evidenceQualifier ? ` ${evidenceQualifier}` : ""}`,
      tone: "info"
    };
  }

  const winner = rows.find((row) => row.agentKind === conclusion.winnerAgentKind);
  if (conclusion.scope === "single-run") {
    return {
      title: locale === "zh-CN"
        ? `${declaredIdentity ? "按声明的模型映射，" : ""}${harnessLabel(conclusion.winnerAgentKind)} 在本次任务中效果更好`
        : `${declaredIdentity ? "Under the declared model mapping, " : ""}${harnessLabel(conclusion.winnerAgentKind)} performed better on this task`,
      detail: locale === "zh-CN"
        ? `结论仅适用于这次任务、仓库基线和冻结配置。${evidenceQualifier ? ` ${evidenceQualifier}` : ""}`
        : `The conclusion applies only to this task, repository baseline, and frozen configuration.${evidenceQualifier ? ` ${evidenceQualifier}` : ""}`,
      tone: "success"
    };
  }

  const stability = conclusion.stability === "consistent"
    ? (locale === "zh-CN" ? "方向一致" : "consistent direction")
    : conclusion.stability === "mixed"
      ? (locale === "zh-CN" ? "结果混合" : "mixed results")
      : (locale === "zh-CN" ? "证据仍不足" : "still inconclusive");
  return {
    title: locale === "zh-CN"
      ? `${declaredIdentity ? "按声明的模型映射，" : ""}${harnessLabel(conclusion.winnerAgentKind)} 在 ${conclusion.sampleCount} 次有效样本中胜出更多`
      : `${declaredIdentity ? "Under the declared model mapping, " : ""}${harnessLabel(conclusion.winnerAgentKind)} won more often across ${conclusion.sampleCount} valid samples`,
    detail: locale === "zh-CN"
      ? `${winner?.wins ?? 0} 次胜出，${stability}。这是当前 cohort 的观察结果，不是统计显著性声明。${evidenceQualifier ? ` ${evidenceQualifier}` : ""}`
      : `${winner?.wins ?? 0} win(s), ${stability}. This describes the current cohort and is not a statistical-significance claim.${evidenceQualifier ? ` ${evidenceQualifier}` : ""}`,
    tone: conclusion.stability === "consistent" ? "success" : "warning"
  };
}

function SampleResultCell({ locale, entry }: { locale: Locale; entry: StrictHarnessSampleResult }) {
  return (
    <div class="sample-result-cell">
      <strong>{entry.result.compositeScore === null ? t(locale, "unknown") : entry.result.compositeScore.toFixed(1)}</strong>
      <StatusPill tone={resultTone(entry)}>{resultStatus(locale, entry)}</StatusPill>
      <small>{formatDuration(entry.result.durationMs, locale)}</small>
    </div>
  );
}

export function ComparePage() {
  const { locale, runs, selectedRun, setSelectedRunId, setPage, preparePlanFromRun } = useWorkbench();
  const preliminary = useMemo(() => buildStrictHarnessComparison(runs), [runs]);
  const selectedIsValid = selectedRun ? inspectStrictHarnessSample(selectedRun).sample !== null : false;
  const initialBaseId = selectedIsValid ? selectedRun?.runId : preliminary.baseRun?.runId;
  const [chosenBaseId, setChosenBaseId] = useState("");
  const effectiveBaseId = chosenBaseId || initialBaseId || "";
  const comparison = useMemo(
    () => buildStrictHarnessComparison(runs, effectiveBaseId || undefined),
    [effectiveBaseId, runs]
  );
  const eligibleRuns = useMemo(
    () => runs.filter((run) => inspectStrictHarnessSample(run).sample !== null),
    [runs]
  );
  const conclusion = conclusionCopy(locale, comparison);
  const baseSample = comparison.samples.find((sample) => sample.run.runId === comparison.baseRun?.runId)
    ?? comparison.samples[0];

  return (
    <>
      <PageHeader
        eyebrow="COMPARE"
        title={locale === "zh-CN" ? "同模型 Harness 对比" : "Same-model Harness comparison"}
        description={locale === "zh-CN"
          ? "只使用 JobManifest 证明身份一致且运行后无漂移的 Codex / Claude 样本。"
          : "Uses only Codex / Claude samples whose matching identities and post-run integrity are proven by JobManifest."}
        actions={comparison.baseRun ? (
          <button class="button ghost" type="button" onClick={() => preparePlanFromRun(comparison.baseRun as NormalizedRun)}>
            <Icon name="refresh" />{locale === "zh-CN" ? "复用该配置" : "Reuse this configuration"}
          </button>
        ) : undefined}
      />

      {eligibleRuns.length > 0 && (
        <Section className="compare-cohort-control" title={locale === "zh-CN" ? "比较 cohort" : "Comparison cohort"}>
          <label class="inline-field" for="strict-compare-base">
            <span>{locale === "zh-CN" ? "基准样本" : "Base sample"}</span>
            <select id="strict-compare-base" value={effectiveBaseId} onChange={(event) => setChosenBaseId(event.currentTarget.value)}>
              {eligibleRuns.map((run) => <option key={run.runId} value={run.runId}>{run.task.title} · {run.runId}</option>)}
            </select>
          </label>
        </Section>
      )}

      <div class={`compare-verdict compare-verdict-${conclusion.tone}`}>
        <span class="compare-verdict-icon"><Icon name={conclusion.tone === "success" ? "check" : conclusion.tone === "warning" ? "warning" : "info"} size={22} /></span>
        <div>
          <span>{locale === "zh-CN" ? "结论" : "Conclusion"}</span>
          <h2>{conclusion.title}</h2>
          <p>{conclusion.detail}</p>
        </div>
      </div>

      {comparison.samples.length === 0 ? (
        <EmptyState
          icon="compare"
          title={locale === "zh-CN" ? "没有合格样本" : "No eligible samples"}
          message={locale === "zh-CN" ? "先用两个已验证 Profile 在同一次评测中运行 Codex 与 Claude。" : "Run Codex and Claude together in one evaluation using two verified profiles."}
          actions={<button class="button primary" type="button" onClick={() => setPage("plan")}>{t(locale, "newEvaluation")}</button>}
        />
      ) : (
        <>
          {baseSample && (
            <Section title={locale === "zh-CN" ? "冻结比较条件" : "Frozen comparison identity"}>
              <dl class="comparison-basis-grid">
                <div><dt>{t(locale, "task")}</dt><dd title={baseSample.taskIdentity}>{shortIdentity(baseSample.taskIdentity)}</dd></div>
                <div><dt>{locale === "zh-CN" ? "仓库基线" : "Repository baseline"}</dt><dd title={baseSample.repositoryBaselineIdentity}>{shortIdentity(baseSample.repositoryBaselineIdentity)}</dd></div>
                <div><dt>{locale === "zh-CN" ? "裁判" : "Judge"}</dt><dd title={baseSample.judgeIdentity}>{shortIdentity(baseSample.judgeIdentity)}</dd></div>
                <div><dt>{t(locale, "scoreMode")}</dt><dd>{baseSample.scoreMode}</dd></div>
                <div><dt>{locale === "zh-CN" ? "规范模型" : "Canonical model"}</dt><dd>{baseSample.canonicalModelIdentity}</dd></div>
                <div><dt>{locale === "zh-CN" ? "模型证据" : "Model evidence"}</dt><dd>{baseSample.modelIdentityEvidence === "confirmed" ? (locale === "zh-CN" ? "运行时确认" : "Runtime confirmed") : (locale === "zh-CN" ? "Profile 声明" : "Profile declared")}</dd></div>
                <div><dt>{locale === "zh-CN" ? "有效样本" : "Valid samples"}</dt><dd>{comparison.samples.length}</dd></div>
              </dl>
            </Section>
          )}

          <Section title={locale === "zh-CN" ? "Harness 结果" : "Harness results"} description={locale === "zh-CN" ? "分数只在同一次运行内比较；多次样本以胜负次数汇总。" : "Scores compare variants only within a run; repeated samples are summarized by wins."}>
            <div class="results-table strict-compare-table">
              <table>
                <caption class="visually-hidden">{locale === "zh-CN" ? "Codex 与 Claude 对比结果" : "Codex and Claude comparison results"}</caption>
                <thead><tr class="results-head">
                  <th scope="col">Harness</th>
                  <th scope="col">{locale === "zh-CN" ? "样本" : "Samples"}</th>
                  <th scope="col">{locale === "zh-CN" ? "合格" : "Qualified"}</th>
                  <th scope="col">{locale === "zh-CN" ? "胜出" : "Wins"}</th>
                  <th scope="col">{locale === "zh-CN" ? "平均分" : "Avg score"}</th>
                  <th scope="col">{locale === "zh-CN" ? "平均耗时" : "Avg duration"}</th>
                  <th scope="col">{locale === "zh-CN" ? "平均 Token" : "Avg tokens"}</th>
                  <th scope="col">{locale === "zh-CN" ? "平均成本" : "Avg cost"}</th>
                </tr></thead>
                <tbody>{comparison.rows.map((row) => (
                  <tr class={`results-row static ${comparison.conclusion.winnerAgentKind === row.agentKind ? "recommended" : ""}`} key={row.agentKind}>
                    <td><span class="identity-cell"><span class="agent-avatar"><Icon name="agent" /></span><span><strong>{harnessLabel(row.agentKind)}</strong><small>{row.displayLabel}</small></span></span></td>
                    <td data-label={locale === "zh-CN" ? "样本" : "Samples"}>{row.samples}</td>
                    <td data-label={locale === "zh-CN" ? "合格" : "Qualified"}>{row.successCount} / {row.samples}</td>
                    <td data-label={locale === "zh-CN" ? "胜出" : "Wins"}><strong>{row.wins}</strong>{row.ties ? <small>{locale === "zh-CN" ? `，平 ${row.ties}` : `, ${row.ties} tie(s)`}</small> : null}</td>
                    <td data-label={locale === "zh-CN" ? "平均分" : "Avg score"}>{row.averageScore === null ? t(locale, "unknown") : row.averageScore.toFixed(1)}</td>
                    <td data-label={locale === "zh-CN" ? "平均耗时" : "Avg duration"}>{formatDuration(row.averageDurationMs, locale)}</td>
                    <td data-label={locale === "zh-CN" ? "平均 Token" : "Avg tokens"}>{row.averageTokens === null ? t(locale, "unknown") : Math.round(row.averageTokens)}</td>
                    <td data-label={locale === "zh-CN" ? "平均成本" : "Avg cost"}>{row.averageCostUsd === null ? t(locale, "unknown") : formatCost(row.averageCostUsd, locale)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Section>

          <Section title={locale === "zh-CN" ? "逐次样本" : "Per-run samples"}>
            <div class="results-table strict-sample-table">
              <table>
                <caption class="visually-hidden">{locale === "zh-CN" ? "每次有效样本详情" : "Each valid sample"}</caption>
                <thead><tr class="results-head">
                  <th scope="col">{locale === "zh-CN" ? "运行" : "Run"}</th>
                  <th scope="col">Codex CLI</th>
                  <th scope="col">Claude Code</th>
                  <th scope="col">{locale === "zh-CN" ? "本次结论" : "Run conclusion"}</th>
                </tr></thead>
                <tbody>{comparison.samples.map((sample) => {
                  const codex = sample.results.find((entry) => entry.agentKind === "codex") as StrictHarnessSampleResult;
                  const claude = sample.results.find((entry) => entry.agentKind === "claude-code") as StrictHarnessSampleResult;
                  return (
                    <tr class="results-row static" key={sample.run.runId}>
                      <td><button class="run-link-button" type="button" onClick={() => { setSelectedRunId(sample.run.runId); setPage("outcome"); }}><strong>{sample.run.runId}</strong><small>{formatTime(sample.run.createdAt, locale)}</small></button></td>
                      <td data-label="Codex CLI"><SampleResultCell locale={locale} entry={codex} /></td>
                      <td data-label="Claude Code"><SampleResultCell locale={locale} entry={claude} /></td>
                      <td data-label={locale === "zh-CN" ? "本次结论" : "Run conclusion"}>{sample.decision.winnerAgentKind
                        ? `${harnessLabel(sample.decision.winnerAgentKind)} ${locale === "zh-CN" ? "更好" : "better"}`
                        : (locale === "zh-CN" ? "持平" : "Tie")}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      {comparison.excluded.length > 0 && (
        <Section title={locale === "zh-CN" ? "未纳入的运行" : "Excluded runs"} description={locale === "zh-CN" ? "这些结果仍可查看，但不会影响上面的结论。" : "These results remain viewable but do not affect the conclusion above."}>
          <div class="comparison-exclusions">
            {comparison.excluded.map((entry) => (
              <div class="comparison-exclusion-row" key={entry.run.runId}>
                <div><strong>{entry.run.task.title}</strong><small>{entry.run.runId}</small></div>
                <div class="reason-pills">{entry.reasons.map((reason) => <StatusPill key={reason} tone="warning">{exclusionLabel(locale, reason)}</StatusPill>)}</div>
                <button class="button ghost compact-button" type="button" onClick={() => { setSelectedRunId(entry.run.runId); setPage("outcome"); }}>{locale === "zh-CN" ? "查看" : "View"}<Icon name="chevron" /></button>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
