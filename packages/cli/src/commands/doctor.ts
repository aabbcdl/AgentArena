import {
  getInstallGuide,
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
    let notReadyCount = 0;

    for (const group of groups) {
      console.log(`${group.emoji} ${group.label} (${group.items.length})`);
      for (const preflight of group.items) {
        const statusIcon =
          preflight.status === "ready"
            ? "✓"
            : preflight.status === "unverified"
              ? "?"
              : "✗";
        if (preflight.status !== "ready") notReadyCount++;
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

        // Show install guide for missing/blocked adapters
        if (preflight.status === "missing" || preflight.status === "blocked") {
          const guide = getInstallGuide(preflight.agentId);
          if (guide) {
            console.log(`     💡 How to fix:`);
            // Show platform-appropriate install commands
            const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
            const platformCmds = guide.install[platform] ?? guide.install.all;
            if (platformCmds) {
              for (const [method, cmd] of Object.entries(platformCmds)) {
                console.log(`        $ ${cmd}  (${method})`);
              }
            }
            if (guide.warnings) {
              for (const warning of guide.warnings) {
                console.log(`        ⚠ ${warning}`);
              }
            }
            if (guide.postInstall) {
              for (const note of guide.postInstall) {
                console.log(`        ℹ ${note}`);
              }
            }
          }
        }

        console.log("");
      }
      console.log("");
    }

    if (notReadyCount > 0) {
      console.log(`⚠ ${notReadyCount} adapter(s) are not ready. Fix the issues above and run 'agentarena doctor' again.`);
      if (parsed.strict) {
        console.log(`   (--strict mode: exiting with error code 1)`);
      }
    }
  }

  if (
    parsed.strict &&
    preflights.some((preflight) => preflight.status !== "ready")
  ) {
    process.exitCode = 1;
  }
}
