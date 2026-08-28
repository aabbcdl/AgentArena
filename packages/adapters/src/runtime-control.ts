import type {
  HarnessSnapshot,
  ResolvedLaunchSpec,
  RuntimeInstallation,
  RuntimeProfile,
  RuntimeSecretValues
} from "@agentarena/core";
import { captureHarnessSnapshot } from "./harness-snapshot.js";
import { discoverRuntimeInstallation } from "./installation-discovery.js";
import { resolveRuntimeLaunchSpec } from "./launch-resolver.js";
import {
  getRuntimeProfile,
  getRuntimeProfileSecret
} from "./runtime-profile-registry.js";
import { resolveCodexRuntime } from "./runtime-resolution.js";

export interface ResolveRuntimeProfileLaunchOptions {
  profileId: string;
  repositoryPath: string;
  repositoryBaselineIdentity: string;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  now?: () => string;
  resolveSecrets?: boolean;
}

export interface ResolvedRuntimeProfileLaunch {
  profile: RuntimeProfile;
  installation: RuntimeInstallation;
  harnessSnapshot: HarnessSnapshot;
  launchSpec: ResolvedLaunchSpec;
  runtimeSecretValues: RuntimeSecretValues;
}

export async function resolveRuntimeProfileLaunch(
  options: ResolveRuntimeProfileLaunchOptions
): Promise<ResolvedRuntimeProfileLaunch> {
  const profile = await getRuntimeProfile(options.profileId);
  const environment = options.environment ?? process.env;
  const installation = await discoverRuntimeInstallation({
    agentKind: profile.agentKind,
    commandPath: profile.commandPath,
    environment,
    cwd: options.repositoryPath,
    includeLocalAuth: profile.mode === "inherit-local",
    now: options.now
  });
  const harnessSnapshot = await captureHarnessSnapshot({
    agentKind: profile.agentKind,
    installation,
    repositoryPath: options.repositoryPath,
    repositoryBaselineIdentity: options.repositoryBaselineIdentity,
    profileMode: profile.mode,
    homeDirectory: options.homeDirectory,
    environment,
    now: options.now
  });
  const codexRuntime = profile.agentKind === "codex" && profile.mode === "inherit-local"
    ? await resolveCodexRuntime({
        requestedConfig: {
          ...(profile.provider?.requestedModel ? { model: profile.provider.requestedModel } : {}),
          ...(profile.provider?.reasoningEffort ? { reasoningEffort: profile.provider.reasoningEffort } : {})
        },
        ...(profile.provider?.requestedModel || profile.provider?.reasoningEffort ? { configSource: "ui" as const } : {}),
        environment
      })
    : undefined;
  const launchSpec = resolveRuntimeLaunchSpec({
    profile,
    installation,
    harnessSnapshot,
    repositoryBaselineIdentity: options.repositoryBaselineIdentity,
    ...(codexRuntime ? { codexRuntime } : {}),
    now: options.now
  });

  const runtimeSecretValues: Record<string, string> = {};
  if (options.resolveSecrets !== false) {
    for (const binding of launchSpec.environment.secretBindings) {
      const secret = await getRuntimeProfileSecret(profile.id);
      if (!secret) {
        throw new Error(`Runtime profile "${profile.id}" requires a task-scoped Secret, but it is unavailable.`);
      }
      runtimeSecretValues[binding.secretRef] = secret;
    }
  }

  return {
    profile,
    installation,
    harnessSnapshot,
    launchSpec,
    runtimeSecretValues
  };
}
