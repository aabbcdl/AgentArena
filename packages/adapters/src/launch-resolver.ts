import { randomUUID } from "node:crypto";
import {
  type AgentResolvedRuntime,
  createResolvedLaunchSpec,
  type HarnessSnapshot,
  hashRuntimeIdentity,
  RESOLVED_LAUNCH_SPEC_SCHEMA_V1,
  type ResolvedLaunchSpec,
  type RuntimeInstallation,
  type RuntimeMutableBinding,
  type RuntimeProfile,
  validateRuntimeProfile
} from "@agentarena/core";

export interface ResolveRuntimeLaunchSpecOptions {
  profile: RuntimeProfile;
  installation: RuntimeInstallation;
  harnessSnapshot: HarnessSnapshot;
  repositoryBaselineIdentity: string;
  /**
   * Runtime identity resolved before freezing an inherited-local Codex launch.
   * The launch spec must contain the effective values so readiness receipts and
   * reports describe the process that will actually be started.
   */
  codexRuntime?: Pick<
    AgentResolvedRuntime,
    "effectiveModel" | "effectiveReasoningEffort" | "modelIdentitySource" | "reasoningEffortSource" | "source"
  >;
  specId?: string;
  now?: () => string;
  timeouts?: Partial<ResolvedLaunchSpec["timeouts"]>;
}

export type RuntimeLaunchBindingValues = Record<RuntimeMutableBinding, string>;
export type RuntimeSecretResolver = (
  secretRef: string,
  secretRevision: number
) => Promise<string | null | undefined> | string | null | undefined;

const MUTABLE_BINDINGS: RuntimeMutableBinding[] = [
  "workspacePath",
  "prompt",
  "outputPath",
  "sessionId"
];

const CODEX_MANAGED_PROVIDER_UNSET = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL"
] as const;
const CLAUDE_MANAGED_PROVIDER_UNSET = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_MODEL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
  "CLAUDE_CODE_USE_GATEWAY",
  "CLAUDE_CODE_USE_MANTLE",
  "AWS_BEARER_TOKEN_BEDROCK"
] as const;

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function configOverride(name: string, value: string): string[] {
  return ["-c", `${name}=${tomlString(value)}`];
}

function assertResolutionInputs(options: ResolveRuntimeLaunchSpecOptions): void {
  const profileErrors = validateRuntimeProfile(options.profile);
  if (profileErrors.length > 0) {
    throw new Error(`Cannot resolve invalid runtime profile: ${profileErrors.join(" ")}`);
  }
  if (
    options.profile.agentKind !== options.installation.agentKind ||
    options.profile.agentKind !== options.harnessSnapshot.agentKind
  ) {
    throw new Error("Profile, installation, and Harness snapshot must use the same agent.");
  }
  if (options.harnessSnapshot.installationFingerprint !== options.installation.fingerprint) {
    throw new Error("Harness snapshot belongs to a different installation fingerprint.");
  }
  if (
    options.harnessSnapshot.repositoryBaselineIdentity !== options.repositoryBaselineIdentity
  ) {
    throw new Error("Harness snapshot belongs to a different repository baseline.");
  }
}

function providerPolicyIdentity(profile: RuntimeProfile): string {
  const baseUrl = profile.provider?.baseUrl
    ? new URL(profile.provider.baseUrl).toString().replace(/\/$/, "")
    : undefined;
  return hashRuntimeIdentity("provider-policy", profile.mode === "inherit-local"
    ? {
        mode: "inherit-local",
        extraEnv: profile.extraEnv
      }
    : {
        mode: profile.mode,
        baseUrl,
        extraEnv: profile.extraEnv
      });
}

function modelParametersIdentity(
  profile: RuntimeProfile,
  codexRuntime?: ResolveRuntimeLaunchSpecOptions["codexRuntime"]
): string {
  const effectiveModel = codexRuntime?.effectiveModel ?? profile.provider?.requestedModel;
  const effectiveReasoningEffort = codexRuntime?.effectiveReasoningEffort ?? profile.provider?.reasoningEffort;
  return hashRuntimeIdentity("model-parameters", {
    canonicalModelIdentity: profile.provider?.canonicalModelIdentity ?? effectiveModel,
    reasoningEffort: effectiveReasoningEffort,
    modelMappings: profile.provider?.modelMappings
  });
}

function resolveCodexCommand(
  profile: RuntimeProfile,
  codexRuntime?: ResolveRuntimeLaunchSpecOptions["codexRuntime"]
): {
  argsTemplate: string[];
  secretBindings: ResolvedLaunchSpec["environment"]["secretBindings"];
} {
  // The npm-distributed Codex Windows build launches a native sandbox helper
  // for workspace-write. On affected installations that helper cannot load,
  // while the existing Codex adapter's full-access mode remains reliable in
  // the disposable AgentArena workspace. Keep the platform behavior aligned.
  const argsTemplate = ["exec", ...configOverride("approval_policy", "never")];
  if (process.platform === "win32") {
    argsTemplate.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    argsTemplate.push("--sandbox", "workspace-write");
  }
  argsTemplate.push("--skip-git-repo-check", "--ephemeral");
  const secretBindings: ResolvedLaunchSpec["environment"]["secretBindings"] = [];

  if (profile.mode === "managed-provider") {
    const provider = profile.provider;
    if (!provider?.baseUrl || !provider.requestedModel || !provider.secretRef) {
      throw new Error("Managed Codex profiles require a Provider URL, model, and Secret reference.");
    }
    if (provider.protocol !== "openai-responses") {
      throw new Error("Codex managed Providers must use the OpenAI Responses protocol in the first release.");
    }
    argsTemplate.push(
      ...configOverride("model_provider", "agentarena"),
      ...configOverride("model_providers.agentarena.name", "AgentArena task Provider"),
      ...configOverride("model_providers.agentarena.base_url", provider.baseUrl),
      ...configOverride("model_providers.agentarena.env_key", "AGENTARENA_CODEX_PROVIDER_KEY"),
      ...configOverride("model_providers.agentarena.wire_api", "responses"),
      ...configOverride("model", provider.requestedModel)
    );
    if (provider.reasoningEffort) {
      argsTemplate.push(...configOverride("model_reasoning_effort", provider.reasoningEffort));
    }
    secretBindings.push({
      environmentVariable: "AGENTARENA_CODEX_PROVIDER_KEY",
      secretRef: provider.secretRef,
      secretRevision: profile.secretRevision
    });
  } else {
    // Inherited-local profiles normally rely on the user's Codex config.toml.
    // Once a launch is frozen, make the resolved defaults explicit so the
    // disposable CODEX_HOME and the receipt cannot silently drift later.
    if (codexRuntime?.effectiveModel) {
      argsTemplate.push(...configOverride("model", codexRuntime.effectiveModel));
    }
    if (codexRuntime?.effectiveReasoningEffort) {
      argsTemplate.push(...configOverride("model_reasoning_effort", codexRuntime.effectiveReasoningEffort));
    }
  }

  argsTemplate.push(
    "--cd",
    "{{workspacePath}}",
    "--output-last-message",
    "{{outputPath}}",
    "--json",
    "-"
  );
  return { argsTemplate, secretBindings };
}

function resolveClaudeCommand(profile: RuntimeProfile): {
  argsTemplate: string[];
  overrides: Record<string, string>;
  secretBindings: ResolvedLaunchSpec["environment"]["secretBindings"];
} {
  const argsTemplate = [
    "--setting-sources",
    "user,project,local",
    "--permission-mode",
    "dontAsk",
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence"
  ];
  const overrides = { ...profile.extraEnv };
  const secretBindings: ResolvedLaunchSpec["environment"]["secretBindings"] = [];

  if (profile.mode === "managed-provider") {
    const provider = profile.provider;
    if (!provider?.baseUrl || !provider.requestedModel || !provider.secretRef) {
      throw new Error("Managed Claude profiles require a Provider URL, model, and Secret reference.");
    }
    if (provider.protocol !== "anthropic-messages" && provider.protocol !== "openai-chat-via-proxy") {
      throw new Error("Claude managed Providers must expose Anthropic Messages compatibility.");
    }
    Object.assign(overrides, {
      ANTHROPIC_BASE_URL: provider.baseUrl,
      ANTHROPIC_MODEL: provider.requestedModel,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1"
    });
    const mappings = provider.modelMappings ?? {};
    if (mappings.haiku) overrides.ANTHROPIC_DEFAULT_HAIKU_MODEL = mappings.haiku;
    if (mappings.sonnet) overrides.ANTHROPIC_DEFAULT_SONNET_MODEL = mappings.sonnet;
    if (mappings.opus) overrides.ANTHROPIC_DEFAULT_OPUS_MODEL = mappings.opus;
    argsTemplate.push("--model", provider.requestedModel);
    secretBindings.push({
      environmentVariable: "ANTHROPIC_AUTH_TOKEN",
      secretRef: provider.secretRef,
      secretRevision: profile.secretRevision
    });
  }
  return { argsTemplate, overrides, secretBindings };
}

export function resolveRuntimeLaunchSpec(
  options: ResolveRuntimeLaunchSpecOptions
): ResolvedLaunchSpec {
  assertResolutionInputs(options);
  const profile = options.profile;
  const commonEnvironment = {
    inheritHost: true,
    overrides: { ...profile.extraEnv },
    unset: [] as string[],
    secretBindings: [] as ResolvedLaunchSpec["environment"]["secretBindings"]
  };

  let argsTemplate: string[];
  if (profile.agentKind === "codex") {
    const resolved = resolveCodexCommand(profile, options.codexRuntime);
    argsTemplate = resolved.argsTemplate;
    commonEnvironment.secretBindings = resolved.secretBindings;
    if (profile.mode === "managed-provider") {
      commonEnvironment.unset = [...CODEX_MANAGED_PROVIDER_UNSET];
    }
  } else {
    const resolved = resolveClaudeCommand(profile);
    argsTemplate = resolved.argsTemplate;
    commonEnvironment.overrides = resolved.overrides;
    commonEnvironment.secretBindings = resolved.secretBindings;
    if (profile.mode === "managed-provider") {
      commonEnvironment.unset = [...CLAUDE_MANAGED_PROVIDER_UNSET];
    }
  }

  const effectiveModel = profile.agentKind === "codex"
    ? options.codexRuntime?.effectiveModel ?? profile.provider?.requestedModel
    : profile.provider?.requestedModel;
  const effectiveReasoningEffort = profile.agentKind === "codex"
    ? options.codexRuntime?.effectiveReasoningEffort ?? profile.provider?.reasoningEffort
    : profile.provider?.reasoningEffort;
  const modelIdentitySource = profile.provider?.modelIdentitySource
    ?? (options.codexRuntime?.modelIdentitySource === "confirmed" || options.codexRuntime?.modelIdentitySource === "declared"
      ? options.codexRuntime.modelIdentitySource
      : effectiveModel ? "declared" : "unknown");

  const now = options.now ?? (() => new Date().toISOString());
  const defaultTimeouts = {
    startupMs: 30_000,
    idleMs: 120_000,
    totalMs: 15 * 60_000
  };
  return createResolvedLaunchSpec({
    schemaVersion: RESOLVED_LAUNCH_SPEC_SCHEMA_V1,
    specId: options.specId ?? `launch-${randomUUID()}`,
    createdAt: now(),
    agentKind: profile.agentKind,
    profile: {
      id: profile.id,
      revision: profile.revision,
      secretRevision: profile.secretRevision
    },
    installation: {
      id: options.installation.id,
      fingerprint: options.installation.fingerprint,
      version: options.installation.version
    },
    harnessSnapshotId: options.harnessSnapshot.snapshotId,
    repositoryBaselineIdentity: options.repositoryBaselineIdentity,
    command: {
      executable: options.installation.executable,
      argsPrefix: [...options.installation.argsPrefix],
      argsTemplate
    },
    environment: commonEnvironment,
    runtime: {
      providerKind: profile.mode === "inherit-local"
        ? "inherited-local"
        : profile.provider?.protocol,
      source: profile.agentKind === "codex"
        ? options.codexRuntime?.source ?? (profile.mode === "managed-provider" ? "profile-config" : "cli-default")
        : undefined,
      requestedModel: effectiveModel,
      canonicalModelIdentity: profile.agentKind === "codex"
        ? profile.provider?.canonicalModelIdentity ?? effectiveModel
        : profile.provider?.canonicalModelIdentity,
      modelIdentitySource,
      reasoningEffort: effectiveReasoningEffort,
      providerPolicyIdentity: providerPolicyIdentity(profile),
      modelParametersIdentity: modelParametersIdentity(profile, options.codexRuntime)
    },
    permissions: {
      mode: profile.agentKind === "codex"
        ? (process.platform === "win32" ? "danger-full-access" : "workspace-write")
        : "dontAsk",
      unattended: true,
      fullBypass: profile.agentKind === "codex" && process.platform === "win32"
    },
    timeouts: {
      ...defaultTimeouts,
      ...options.timeouts
    },
    mutableBindings: [...MUTABLE_BINDINGS]
  });
}

export function materializeRuntimeLaunchArguments(
  spec: ResolvedLaunchSpec,
  bindings: RuntimeLaunchBindingValues
): string[] {
  const replacements = new Map<RuntimeMutableBinding, string>(
    MUTABLE_BINDINGS.map((binding) => [binding, bindings[binding]])
  );
  return [...spec.command.argsPrefix, ...spec.command.argsTemplate].map((argument) => {
    return argument.replace(/\{\{(workspacePath|prompt|outputPath|sessionId)\}\}/g, (_match: string, binding: RuntimeMutableBinding) => {
      const value = replacements.get(binding);
      if (value === undefined) throw new Error(`Missing runtime launch binding ${binding}.`);
      return value;
    });
  });
}

function deleteEnvironmentKey(environment: NodeJS.ProcessEnv, name: string): void {
  const normalized = name.toUpperCase();
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === normalized) delete environment[key];
  }
}

export async function materializeRuntimeLaunchEnvironment(
  spec: ResolvedLaunchSpec,
  hostEnvironment: NodeJS.ProcessEnv,
  resolveSecret: RuntimeSecretResolver
): Promise<NodeJS.ProcessEnv> {
  const environment: NodeJS.ProcessEnv = spec.environment.inheritHost
    ? { ...hostEnvironment }
    : {};
  for (const name of spec.environment.unset) deleteEnvironmentKey(environment, name);
  for (const [name, value] of Object.entries(spec.environment.overrides)) {
    deleteEnvironmentKey(environment, name);
    environment[name] = value;
  }
  for (const binding of spec.environment.secretBindings) {
    const value = await resolveSecret(binding.secretRef, binding.secretRevision);
    if (!value) {
      throw new Error(
        `Runtime Secret for ${binding.environmentVariable} at revision ${binding.secretRevision} is unavailable.`
      );
    }
    deleteEnvironmentKey(environment, binding.environmentVariable);
    environment[binding.environmentVariable] = value;
  }
  return environment;
}

export function resolvedAgentRuntimeFromLaunchSpec(spec: ResolvedLaunchSpec): AgentResolvedRuntime {
  const inherited = spec.runtime.providerKind === "inherited-local";
  const source = spec.runtime.source ?? (inherited
    ? (spec.agentKind === "claude-code" ? "official-login" : "cli-default")
    : "profile-config");
  return {
    effectiveModel: spec.runtime.requestedModel,
    effectiveReasoningEffort: spec.runtime.reasoningEffort,
    ...(spec.runtime.requestedModel
      ? { modelIdentitySource: spec.runtime.modelIdentitySource }
      : {}),
    ...(spec.runtime.reasoningEffort
      ? { reasoningEffortSource: spec.runtime.modelIdentitySource === "unknown" ? "unknown" as const : "declared" as const }
      : {}),
    effectiveAgentVersion: spec.installation.version,
    agentVersionSource: spec.installation.version ? "version-command" : "unknown",
    providerProfileId: spec.profile.id,
    providerProfileName: spec.profile.id,
    providerSource: inherited
      ? (spec.agentKind === "claude-code" ? "official-login" : "unknown")
      : "profile-config",
    source,
    verification: "inferred",
    notes: [`Frozen LaunchSpec ${spec.launchSpecHash}`]
  };
}
