import {
  listAvailableAdapters,
  preflightAdapters,
} from "@agentarena/adapters";
import { createAgentSelection } from "@agentarena/core";
import type { ParsedArgs } from "../args.js";
import {
  getAvailabilityEmoji,
  groupByTier,
  normalizeCliSelections,
} from "./shared.js";

export async function runDoctor(parsed: ParsedArgs): Promise<void> {
  const selections =
    parsed.agentIds.length > 0
      ? normalizeCliSelections(parsed)
      : listAvailableAdapters()
          .map((adapter) =>
            createAgentSelection({
              baseAgentId: adapter.id,
              displayLabel: adapter.title,
            }),
          )
          .sort((left, right) =>
            left.baseAgentId.localeCompare(right.baseAgentId),
          );

  const preflights = await preflightAdapters(selections, {
    probeAuth: parsed.probeAuth,
  });

  if (parsed.format === "json") {
    console.log(JSON.stringify(preflights, null, 2));
  } else {
    console.log("\n🏥 AgentArena Doctor\n");

    const groups = groupByTier(preflights);

    for (const group of groups) {
      console.log(`${group.emoji} ${group.label} (${group.items.length})`);
      for (const preflight of group.items) {
        const statusIcon =
          preflight.status === "ready"
            ? "✓"
            : preflight.status === "unverified"
              ? "?"
              : "✗";
        console.log(
          `   • ${preflight.agentId.padEnd(20)} ${preflight.capability.invocationMethod}`,
        );
        console.log(
          `     ${getAvailabilityEmoji(preflight.capability.tokenAvailability)} tokens | ${getAvailabilityEmoji(preflight.capability.costAvailability)} cost | ${getAvailabilityEmoji(preflight.capability.traceRichness)} trace`,
        );
        console.log(
          `     status: ${statusIcon} ${preflight.status} - ${preflight.summary}`,
        );

        if (preflight.command) {
          console.log(`     command: ${preflight.command}`);
        }
        for (const detail of preflight.details ?? []) {
          console.log(`     detail: ${detail}`);
        }
        if (preflight.capability.authPrerequisites.length > 0) {
          console.log(
            `     auth: ${preflight.capability.authPrerequisites.join("; ")}`,
          );
        }
        for (const limitation of preflight.capability.knownLimitations) {
          console.log(`     limitation: ${limitation}`);
        }
        console.log("");
      }
      console.log("");
    }
  }

  if (
    parsed.strict &&
    preflights.some((preflight) => preflight.status !== "ready")
  ) {
    process.exitCode = 1;
  }
}
