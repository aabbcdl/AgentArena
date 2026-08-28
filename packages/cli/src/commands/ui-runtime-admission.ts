import {
  findValidVerificationReceipt,
  resolveRuntimeProfileLaunch
} from "@agentarena/adapters";
import type { AgentSelection } from "@agentarena/core";
import {
  type RuntimeExecutionBindings,
  repositoryIdentity
} from "@agentarena/runner";

export interface UiRuntimeAdmission {
  selections: AgentSelection[];
  runtimeBindings?: RuntimeExecutionBindings;
  repositoryBaselineIdentity: string;
}

export async function prepareUiRuntimeAdmission(
  selections: AgentSelection[],
  repositoryPath: string,
  hostEnvironment: NodeJS.ProcessEnv = process.env
): Promise<UiRuntimeAdmission> {
  const repositoryBaselineIdentity = repositoryIdentity(repositoryPath);
  const frozenSelectionCount = selections.filter((selection) => selection.runtimeProfileId).length;
  if (frozenSelectionCount === 0) {
    return { selections, repositoryBaselineIdentity };
  }
  if (frozenSelectionCount !== selections.length) {
    throw new Error(
      "RuntimeProfile Harnesses cannot be mixed with legacy or demo selections in the same run."
    );
  }

  const admittedSelections: AgentSelection[] = [];
  const runtimeBindings: Record<string, RuntimeExecutionBindings[string]> = {};
  for (const selection of selections) {
    if (!selection.runtimeProfileId) continue;
    if (selection.baseAgentId !== "codex" && selection.baseAgentId !== "claude-code") {
      throw new Error(
        `RuntimeProfile selections support only Codex and Claude Code, not "${selection.baseAgentId}".`
      );
    }

    const resolved = await resolveRuntimeProfileLaunch({
      profileId: selection.runtimeProfileId,
      repositoryPath,
      repositoryBaselineIdentity,
      environment: hostEnvironment
    });
    if (resolved.profile.agentKind !== selection.baseAgentId) {
      throw new Error(
        `RuntimeProfile "${resolved.profile.id}" belongs to ${resolved.profile.agentKind}, not ${selection.baseAgentId}.`
      );
    }
    const receipt = await findValidVerificationReceipt(resolved.launchSpec);
    if (!receipt) {
      throw new Error(
        `RuntimeProfile "${resolved.profile.name}" is not Task-ready for the current repository and Harness. Verify it again before starting this run.`
      );
    }
    if (
      selection.launchSpecHash &&
      selection.launchSpecHash !== resolved.launchSpec.launchSpecHash
    ) {
      throw new Error(
        `RuntimeProfile "${resolved.profile.name}" changed between readiness refresh and start (LaunchSpec drift). Verify it again before starting this run.`
      );
    }
    if (
      selection.verificationReceiptId &&
      selection.verificationReceiptId !== receipt.receiptId
    ) {
      throw new Error(
        `RuntimeProfile "${resolved.profile.name}" has a stale verification receipt. Refresh readiness or run the three-stage verification again.`
      );
    }

    const admittedSelection: AgentSelection = {
      ...selection,
      launchSpecHash: resolved.launchSpec.launchSpecHash,
      verificationReceiptId: receipt.receiptId
    };
    admittedSelections.push(admittedSelection);
    runtimeBindings[admittedSelection.variantId] = {
      profile: resolved.profile,
      installation: resolved.installation,
      harnessSnapshot: resolved.harnessSnapshot,
      launchSpec: resolved.launchSpec,
      verificationReceipt: receipt,
      runtimeSecretValues: resolved.runtimeSecretValues,
      harnessRiskFlags: resolved.harnessSnapshot.riskFlags,
      hostEnvironment: { ...hostEnvironment },
      registryBacked: true
    };
  }

  return {
    selections: admittedSelections,
    runtimeBindings,
    repositoryBaselineIdentity
  };
}
