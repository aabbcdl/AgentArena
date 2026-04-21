# Fair Comparison in the Web Report

AgentArena should stop presenting mixed-context results as if they form one trustworthy ranking.

This spec defines a first iteration of fairness-aware comparison in the web report. The scope is intentionally narrow: improve fairness at result-display time without changing benchmark execution.

## Problem

The current report experience can place results into the same comparison surface even when they were produced under meaningfully different conditions.

That creates a trust problem:

- users can read one ranking as if all rows were directly comparable
- differing repository baselines make apparent performance gaps meaningless
- differing task packs or judge logic can turn the same score into a different claim
- incomplete result data can still look rankable even when it should not drive conclusions

The product goal for this iteration is not to score fairness in the abstract. It is to prevent the main report conclusions from being built on unfair comparisons.

## Goal

When the report shows a primary comparison, it should only rank results that meet a strict fairness bar.

Results that fail that bar should remain visible, but they must be excluded from the main comparison area and clearly labeled with the reason they were excluded.

## Non-Goals

This iteration does not:

- block benchmark execution before a run starts
- add a fairness score, grade, or confidence percentage
- introduce strict-vs-loose comparison modes
- infer partial fairness from task-related file changes
- solve stability or repeatability analysis beyond basic data completeness

## Product Decision

Use a strict primary comparison view with explicit exclusion reasons.

The report should have two conceptual result sets:

1. **Fairly comparable results** — eligible for main conclusions and ranking
2. **Excluded results** — still visible, but not allowed to shape the main comparison

This is intentionally stricter than a warning-only approach. The product should prevent misleading conclusions, not merely annotate them.

## Fair Comparison Rules (v1)

A result is eligible for the main comparison only if all of the following are true:

1. **Same task pack identity**
   - The result must come from the same task definition context as the other results in the comparison set.
   - If task packs differ, the result is excluded.

2. **Same judge logic identity**
   - The result must use the same judge configuration or equivalent judge definition fingerprint.
   - If the scoring criteria differ, the result is excluded.

3. **Same repository baseline**
   - The result must be based on the same repository baseline identity.
   - This is a hard rule. If the repository baseline differs, the comparison is not meaningful enough for the main ranking.

4. **Sufficient core result data**
   - The result must include the minimum data needed to support comparison-oriented conclusions.
   - At minimum this includes final status, core score or ranking inputs, and key judge outcome data.
   - If the result is too incomplete to support comparison, it is excluded.

## Explicitly Deferred Rules

The following should not be hard fairness gates in v1:

- missing token or cost data by itself
- duration variance by itself
- run-to-run instability analysis
- environment quality heuristics that are not already encoded in result identity

Those belong to later trust and quality layers, not the first fairness gate.

## Report Behavior

### Main Comparison Area

The main comparison area should only consume fairly comparable results.

This affects all primary report conclusions derived from comparison, including:

- ranking tables
- best result callouts
- fastest result callouts
- lowest cost callouts
- headline summary statements that imply comparison

The UI should state clearly that the main comparison only includes fairly comparable results.

If only one result remains after fairness filtering, the report should avoid presenting that state as a meaningful ranking. It should instead communicate that only one fairly comparable result is available.

### Excluded Results Area

Results that fail fairness eligibility should appear in a separate section.

This section should:

- stay visible in the report rather than hiding excluded data
- list each excluded result once
- show all applicable exclusion reasons for each result
- avoid framing exclusion as a run failure when the issue is comparability, not execution quality

The language should be plain and user-facing rather than rule-engine jargon.

Examples:

- “This result was not included in the main ranking because it used a different repository baseline.”
- “This result was not included in the main ranking because it used a different task pack.”
- “This result was not included in the main ranking because key comparison data is missing.”

## UX Structure

The report should keep the existing comparison workflow recognizable while splitting comparison into two layers:

1. **Primary comparison section**
   - clearly labeled as fair comparison only
   - contains rankings and comparison-derived highlights

2. **Excluded from fair comparison section**
   - placed near the comparison area, not buried at the bottom
   - explains why specific results were not ranked together

This preserves access to all data while preventing mixed-context rows from polluting the main story.

## Data Model Expectations

The display layer needs stable identity inputs for:

- task pack identity
- judge logic identity
- repository baseline identity
- result completeness

If current summary data does not expose one or more of these cleanly, the implementation should add the smallest possible metadata surface needed to support deterministic fairness filtering.

The design does not require a specific hashing or fingerprinting scheme, only that the UI can make a deterministic fair-comparison decision.

## Edge Cases

### Only one fair result

Do not present a normal ranked comparison. Show the single result as the only fairly comparable result and explain that no fair multi-result ranking is available.

### All results excluded

Show no main ranking. Replace it with a clear empty state explaining that no results met the fairness rules for direct comparison, then show the excluded results section with reasons.

### Multiple exclusion reasons

Show every applicable reason for one result. Do not collapse to a single reason if multiple fairness rules failed.

## Success Criteria

This iteration is successful if:

- the main ranking never mixes differing repository baselines
- task-pack and judge mismatches no longer shape primary conclusions
- incomplete results stop appearing as normal ranking rows
- users can still inspect excluded results and understand why they were excluded
- the comparison page becomes harder to misread without requiring a new execution workflow

## Implementation Scope Guidance

Keep the first implementation focused on four deliverables:

1. define a deterministic fair-comparison eligibility function
2. route primary comparison summaries and tables through that filter
3. add an excluded-results section with human-readable reasons
4. adjust comparison copy for zero-result and one-result edge states

Anything beyond that should be treated as follow-up work, not part of this first slice.
