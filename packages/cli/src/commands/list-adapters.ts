import {
  listAvailableAdapters,
  preflightAdapters,
} from "@agentarena/adapters";
import { createAgentSelection } from "@agentarena/core";
import {
  getAvailabilityEmoji,
  groupByTier,
} from "./shared.js";

export async function runListAdapters(parsed: {
  format?: string;
  detect?: boolean;
}): Promise<void> {
  const adapters = listAvailableAdapters()
    .map((adapter) => ({
      id: adapter.id,
      title: adapter.title,
      kind: adapter.kind,
      capability: adapter.capability,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  // Run quick detection to show installed/auth status
  let preflightMap: Map<string, { status: string; summary: string }> | undefined;
  try {
    const selections = adapters
      .filter((a) => a.kind !== "demo")
      .map((a) => createAgentSelection({ baseAgentId: a.id, displayLabel: a.title }));
    const preflights = await preflightAdapters(selections, { probeAuth: false });
    preflightMap = new Map(preflights.map((p) => [p.agentId, { status: p.status, summary: p.summary }]));
  } catch {
    // Detection failed — show static info only
  }

  if (parsed.format === "json") {
    console.log(JSON.stringify(adapters, null, 2));
    return;
  }

  console.log("\n🏥 AgentArena Adapters\n");

  const groups = groupByTier(adapters);

  for (const group of groups) {
    console.log(`${group.emoji} ${group.label} (${group.items.length})`);
    for (const adapter of group.items) {
      console.log(
        `   • ${adapter.id.padEnd(20)} ${adapter.capability.invocationMethod}`,
      );
      console.log(
        `     ${getAvailabilityEmoji(adapter.capability.tokenAvailability)} tokens | ${getAvailabilityEmoji(adapter.capability.costAvailability)} cost | ${getAvailabilityEmoji(adapter.capability.traceRichness)} trace`,
      );

      // Show detection status if available
      const detected = preflightMap?.get(adapter.id);
      if (detected) {
        const statusIcon = detected.status === "ready" ? "✓" : detected.status === "unverified" ? "?" : "✗";
        console.log(`     installed: ${statusIcon} ${detected.status} — ${detected.summary}`);
      }

      if (adapter.capability.authPrerequisites.length > 0) {
        console.log(
          `     auth: ${adapter.capability.authPrerequisites.join("; ")}`,
        );
      }
      for (const limitation of adapter.capability.knownLimitations) {
        console.log(`     limitation: ${limitation}`);
      }
      console.log(`     test: agentarena doctor --agents ${adapter.id}`);
      console.log("");
    }
    console.log("");
  }
}
