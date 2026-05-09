import { listAvailableAdapters } from "@agentarena/adapters";
import {
  getAvailabilityEmoji,
  groupByTier,
} from "./shared.js";

export async function runListAdapters(parsed: {
  format?: string;
}): Promise<void> {
  const adapters = listAvailableAdapters()
    .map((adapter) => ({
      id: adapter.id,
      title: adapter.title,
      kind: adapter.kind,
      capability: adapter.capability,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

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

      if (adapter.capability.authPrerequisites.length > 0) {
        console.log(
          `     auth: ${adapter.capability.authPrerequisites.join("; ")}`,
        );
      }
      for (const limitation of adapter.capability.knownLimitations) {
        console.log(`     limitation: ${limitation}`);
      }
      console.log("");
    }
    console.log("");
  }
}
