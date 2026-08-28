import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyRepository,
  diffSnapshots,
  type ResolvedLaunchSpec,
  type RuntimeVerificationErrorCategory,
  redactSensitiveText,
  snapshotDirectory,
  VERIFICATION_RECEIPT_SCHEMA_V1,
  type VerificationReceipt,
  type VerificationStageResult
} from "@agentarena/core";
import { prepareCodexRuntimeHome } from "./codex-runtime-home.js";
import {
  materializeRuntimeLaunchArguments,
  materializeRuntimeLaunchEnvironment
} from "./launch-resolver.js";
import { type ProcessResult, runProcess } from "./process-utils.js";

const PROBE_FILE_NAME = "agentarena-runtime-probe.txt";
const MAX_EVIDENCE_LENGTH = 1_500;
const ANSI_ESCAPE_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "g"
);
const NETWORK_HOST_SEQUENCE = /(?<![\w.])(?:(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\])(?::\d{1,5})?(?![\w.])/gi;

interface VerificationEvidenceRedactions {
  secrets: readonly string[];
  environment: readonly string[];
}

export interface ClassifyRuntimeVerificationFailureOptions {
  stage: VerificationStageResult["stage"];
  message: string;
  timedOut?: boolean;
  exitCode?: number | null;
}

export interface VerifyRuntimeLaunchOptions {
  launchSpec: ResolvedLaunchSpec;
  repositoryPath: string;
  hostEnvironment?: NodeJS.ProcessEnv;
  runtimeSecretValues?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  now?: () => string;
  createId?: () => string;
  onStageStart?: (stage: VerificationStageResult["stage"], startedAt: string) => void;
  onStageComplete?: (stage: VerificationStageResult) => void;
}

function cleanOutput(value: string, redactions: VerificationEvidenceRedactions): string {
  let output = value.replace(ANSI_ESCAPE_SEQUENCE, "").trim();
  for (const secret of [...redactions.secrets].sort((left, right) => right.length - left.length)) {
    if (secret.length >= 4) output = output.split(secret).join("[redacted]");
  }
  for (const environmentValue of [...redactions.environment].sort((left, right) => right.length - left.length)) {
    if (environmentValue.length >= 4) {
      output = output.split(environmentValue).join("[redacted environment]");
    }
  }
  output = output.replace(NETWORK_HOST_SEQUENCE, "[redacted network]");
  output = redactSensitiveText(output);
  if (output.length > MAX_EVIDENCE_LENGTH) {
    return `${output.slice(0, MAX_EVIDENCE_LENGTH)}\n[output truncated]`;
  }
  return output;
}

function processEvidence(result: ProcessResult, redactions: VerificationEvidenceRedactions): string[] {
  return [result.stderr, result.stdout]
    .map((value) => cleanOutput(value, redactions))
    .filter(Boolean)
    .slice(0, 2);
}

function evidenceEnvironmentValues(
  environment: NodeJS.ProcessEnv,
  includeAllValues = false
): string[] {
  const routeOrSecretName = /(?:^|_)(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|PRIVATE_KEY|PASSWORD|SECRET|TOKEN|BASE_URL|ENDPOINT|GATEWAY|PROXY|ROUTE)(?:$|_)/i;
  const runtimePathName = /^(?:PATH|CODEX_HOME|CLAUDE_CONFIG_DIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP)$/i;
  const values = new Set<string>();
  for (const [name, value] of Object.entries(environment)) {
    if (
      !value?.trim()
      || (!includeAllValues && !routeOrSecretName.test(name) && !runtimePathName.test(name))
    ) continue;
    const trimmed = value.trim();
    values.add(trimmed);
    try {
      const parsed = new URL(trimmed);
      values.add(parsed.origin);
      if (parsed.host.includes(".") || parsed.host.includes(":")) values.add(parsed.host);
    } catch {
      // Non-URL credentials and routes are still redacted by their exact value.
    }
  }
  return [...values];
}

function stageResult(
  stage: VerificationStageResult["stage"],
  status: VerificationStageResult["status"],
  startedAt: string,
  startedMs: number,
  summary: string,
  options: Partial<Omit<VerificationStageResult, "stage" | "status" | "startedAt" | "durationMs" | "summary">> = {}
): VerificationStageResult {
  return {
    stage,
    status,
    startedAt,
    durationMs: Math.max(0, Date.now() - startedMs),
    summary,
    ...options
  };
}

function skippedStage(stage: "conversation" | "task", now: () => string, summary: string): VerificationStageResult {
  return {
    stage,
    status: "skipped",
    startedAt: now(),
    durationMs: 0,
    summary
  };
}

export function classifyRuntimeVerificationFailure(
  options: ClassifyRuntimeVerificationFailureOptions
): RuntimeVerificationErrorCategory {
  const message = options.message.toLowerCase();
  if (/stream disconnected before completion|reconnecting(?:\.{3})?\s+\d+\/\d+/.test(message)) {
    return "provider-unreachable";
  }
  if (options.timedOut) return options.stage === "task" ? "task-timeout" : "probe-timeout";
  if (/runtime secret|secret.+(?:missing|unavailable|not found)/.test(message)) return "secret-missing";
  if (/\b(?:401|403)\b|unauthori[sz]ed|forbidden|invalid (?:api )?(?:key|token)|authentication (?:failed|rejected)/.test(message)) {
    return "authentication-rejected";
  }
  if (/\b404\b/.test(message) && /model|deployment|engine/.test(message)) return "model-unavailable";
  if (/\b429\b/.test(message) && /quota|credit|billing|limit exhausted/.test(message)) return "quota-exhausted";
  if (/\b429\b|\b5\d\d\b|overload|service unavailable|temporarily unavailable|too many requests/.test(message)) {
    return "provider-overloaded";
  }
  if (/enotfound|econnrefused|econnreset|network|dns|socket|unable to connect|connection (?:failed|refused)/.test(message)) {
    return "provider-unreachable";
  }
  if (/permission|operation not permitted|eacces|access denied|dontask/.test(message)) return "permission-blocked";
  if (/invalid json|json parse|protocol|unexpected response|unsupported media|content-type/.test(message)) {
    return "protocol-mismatch";
  }
  if (/output format|structured output|sentinel|result event/.test(message)) return "output-format-changed";
  if (/enoent|not recognized|not found|failed to spawn|could not be launched/.test(message)) {
    return options.stage === "installation" ? "installation-missing" : "harness-startup-failed";
  }
  if (options.stage === "installation") return "installation-changed";
  return options.exitCode != null && options.exitCode !== 0 ? "process-crashed" : "harness-startup-failed";
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function structuredPayloadCandidates(stdout: string, finalMessage: string): unknown[] {
  const candidates: unknown[] = [];
  if (finalMessage.trim()) candidates.push(tryParseJson(finalMessage));
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const parsedLine = tryParseJson(line);
    candidates.push(parsedLine);
    if (parsedLine && typeof parsedLine === "object" && !Array.isArray(parsedLine)) {
      const record = parsedLine as Record<string, unknown>;
      if (record.result !== undefined) candidates.push(tryParseJson(record.result));
      if (record.message !== undefined) candidates.push(tryParseJson(record.message));
    }
  }
  return candidates;
}

function structuredTerminalFailure(stdout: string): string | undefined {
  let terminalFailure: string | undefined;
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const parsedLine = tryParseJson(line);
    if (!parsedLine || typeof parsedLine !== "object" || Array.isArray(parsedLine)) continue;
    const record = parsedLine as Record<string, unknown>;
    const failed = record.is_error === true
      || record.type === "error"
      || (record.type === "result" && record.subtype === "error");
    if (!failed) continue;
    const detail = [record.error, record.result, record.message]
      .find((value) => typeof value === "string" && value.trim());
    terminalFailure = typeof detail === "string" ? detail : JSON.stringify(record);
  }
  return terminalFailure;
}

function hasStructuredSentinel(
  stdout: string,
  finalMessage: string,
  key: "agentarena_probe" | "agentarena_task_probe",
  sentinel: string
): boolean {
  return structuredPayloadCandidates(stdout, finalMessage).some((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    return (candidate as Record<string, unknown>)[key] === sentinel;
  });
}

async function readFinalMessage(outputPath: string): Promise<string> {
  return await fs.readFile(outputPath, "utf8").catch(() => "");
}

async function runFrozenProbe(options: {
  launchSpec: ResolvedLaunchSpec;
  workspacePath: string;
  outputPath: string;
  prompt: string;
  environment: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  sessionId: string;
}): Promise<ProcessResult> {
  const args = materializeRuntimeLaunchArguments(options.launchSpec, {
    workspacePath: options.workspacePath,
    prompt: options.prompt,
    outputPath: options.outputPath,
    sessionId: options.sessionId
  });
  return await runProcess(
    options.launchSpec.command.executable,
    args,
    options.workspacePath,
    options.launchSpec.timeouts.totalMs,
    options.environment,
    options.signal,
    options.prompt,
    { idleTimeoutMs: options.launchSpec.timeouts.idleMs }
  );
}

async function verifyInstallation(
  launchSpec: ResolvedLaunchSpec,
  hostEnvironment: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined,
  now: () => string,
  redactions: VerificationEvidenceRedactions
): Promise<VerificationStageResult> {
  const startedAt = now();
  const startedMs = Date.now();
  const result = await runProcess(
    launchSpec.command.executable,
    [...launchSpec.command.argsPrefix, "--version"],
    process.cwd(),
    launchSpec.timeouts.startupMs,
    hostEnvironment,
    signal
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const expectedVersion = launchSpec.installation.version;
  const versionChanged = expectedVersion ? !output.includes(expectedVersion) : false;
  if (result.exitCode !== 0 || result.error || result.timedOut || versionChanged) {
    const message = versionChanged
      ? `Installed CLI version no longer matches ${expectedVersion}.`
      : `${result.error ?? ""}\n${output}`;
    return stageResult("installation", "failed", startedAt, startedMs, "The CLI installation could not be verified.", {
      exitCode: result.exitCode,
      errorCategory: classifyRuntimeVerificationFailure({
        stage: "installation",
        message,
        timedOut: result.timedOut,
        exitCode: result.exitCode
      }),
      details: processEvidence(result, redactions)
    });
  }
  return stageResult("installation", "passed", startedAt, startedMs, "CLI installation and version match the frozen launch.", {
    exitCode: result.exitCode
  });
}

async function verifyConversation(options: {
  launchSpec: ResolvedLaunchSpec;
  environment: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  now: () => string;
  redactions: VerificationEvidenceRedactions;
}): Promise<VerificationStageResult> {
  const startedAt = options.now();
  const startedMs = Date.now();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-conversation-probe-"));
  const metadataDir = path.join(root, ".agentarena");
  const outputPath = path.join(metadataDir, "last-message.txt");
  const sentinel = randomUUID().toLowerCase();
  const prompt = [
    "This is an AgentArena readiness probe. Do not use tools or modify files.",
    `Return a JSON object with exactly this field and value: {"agentarena_probe":"${sentinel}"}`,
    `The required sentinel is agentarena-conversation:${sentinel}.`
  ].join("\n");
  try {
    await fs.mkdir(metadataDir, { recursive: true });
    const result = await runFrozenProbe({
      launchSpec: options.launchSpec,
      workspacePath: root,
      outputPath,
      prompt,
      environment: options.environment,
      signal: options.signal,
      sessionId: `conversation-${sentinel}`
    });
    const finalMessage = await readFinalMessage(outputPath);
    const terminalFailure = structuredTerminalFailure(result.stdout);
    if (result.exitCode !== 0 || result.error || result.timedOut || terminalFailure) {
      const message = `${terminalFailure ?? ""}\n${result.error ?? ""}\n${result.stderr}\n${result.stdout}`;
      return stageResult("conversation", "failed", startedAt, startedMs, "The CLI started, but the Provider conversation failed.", {
        exitCode: result.exitCode,
        errorCategory: classifyRuntimeVerificationFailure({
          stage: "conversation",
          message,
          timedOut: result.timedOut,
          exitCode: result.exitCode
        }),
        details: terminalFailure
          ? [cleanOutput(terminalFailure, options.redactions)]
          : processEvidence(result, options.redactions)
      });
    }
    if (!hasStructuredSentinel(result.stdout, finalMessage, "agentarena_probe", sentinel)) {
      return stageResult("conversation", "failed", startedAt, startedMs, "The Provider responded without the required structured sentinel.", {
        exitCode: result.exitCode,
        errorCategory: "output-format-changed",
        details: processEvidence(result, options.redactions)
      });
    }
    return stageResult("conversation", "passed", startedAt, startedMs, "A real Provider conversation returned the expected structured result.", {
      exitCode: result.exitCode
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function verifyTask(options: {
  launchSpec: ResolvedLaunchSpec;
  repositoryPath: string;
  environment: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  now: () => string;
  redactions: VerificationEvidenceRedactions;
}): Promise<VerificationStageResult> {
  const startedAt = options.now();
  const startedMs = Date.now();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-task-probe-"));
  const workspacePath = path.join(root, "workspace");
  const metadataDir = path.join(workspacePath, ".agentarena");
  const outputPath = path.join(metadataDir, "last-message.txt");
  const probePath = path.join(workspacePath, PROBE_FILE_NAME);
  const sentinel = randomUUID().toLowerCase();
  const expectedContent = `agentarena-ready:${sentinel}\n`;
  const prompt = [
    "This is an AgentArena repository readiness probe.",
    `Create exactly one new file named ${PROBE_FILE_NAME}.`,
    `Its entire content must be exactly agentarena-ready:${sentinel} followed by one newline.`,
    "Do not modify, delete, or create any other file.",
    `After the edit, return {"agentarena_task_probe":"${sentinel}"} as structured JSON.`
  ].join("\n");
  try {
    await copyRepository(options.repositoryPath, workspacePath);
    if (await fs.access(probePath).then(() => true).catch(() => false)) {
      return stageResult("task", "failed", startedAt, startedMs, "The repository already contains the reserved verification probe path.", {
        errorCategory: "unexpected-workspace-change"
      });
    }
    await fs.mkdir(metadataDir, { recursive: true });
    const before = await snapshotDirectory(workspacePath);
    const result = await runFrozenProbe({
      launchSpec: options.launchSpec,
      workspacePath,
      outputPath,
      prompt,
      environment: options.environment,
      signal: options.signal,
      sessionId: `task-${sentinel}`
    });
    const finalMessage = await readFinalMessage(outputPath);
    const terminalFailure = structuredTerminalFailure(result.stdout);
    if (result.exitCode !== 0 || result.error || result.timedOut || terminalFailure) {
      const message = `${terminalFailure ?? ""}\n${result.error ?? ""}\n${result.stderr}\n${result.stdout}`;
      return stageResult("task", "failed", startedAt, startedMs, "The repository edit probe did not complete.", {
        exitCode: result.exitCode,
        errorCategory: classifyRuntimeVerificationFailure({
          stage: "task",
          message,
          timedOut: result.timedOut,
          exitCode: result.exitCode
        }),
        details: terminalFailure
          ? [cleanOutput(terminalFailure, options.redactions)]
          : processEvidence(result, options.redactions)
      });
    }
    const after = await snapshotDirectory(workspacePath);
    const diff = diffSnapshots(before, after);
    const content = await fs.readFile(probePath, "utf8").catch(() => "");
    const exactDiff = (
      diff.added.length === 1 &&
      diff.added[0] === PROBE_FILE_NAME &&
      diff.changed.length === 0 &&
      diff.removed.length === 0 &&
      content === expectedContent
    );
    const structuredResult = hasStructuredSentinel(
      result.stdout,
      finalMessage,
      "agentarena_task_probe",
      sentinel
    );
    if (!exactDiff) {
      return stageResult("task", "failed", startedAt, startedMs, "The CLI changed files outside the exact verification contract.", {
        exitCode: result.exitCode,
        errorCategory: "unexpected-workspace-change",
        details: [
          `Added: ${diff.added.join(", ") || "none"}`,
          `Changed: ${diff.changed.join(", ") || "none"}`,
          `Removed: ${diff.removed.join(", ") || "none"}`
        ]
      });
    }
    if (!structuredResult) {
      return stageResult("task", "failed", startedAt, startedMs, "The file edit succeeded, but structured task confirmation was missing.", {
        exitCode: result.exitCode,
        errorCategory: "output-format-changed",
        details: processEvidence(result, options.redactions)
      });
    }
    return stageResult("task", "passed", startedAt, startedMs, "The frozen launch completed the exact edit in a disposable repository copy.", {
      exitCode: result.exitCode,
      details: [`Added exactly ${PROBE_FILE_NAME}.`]
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

export async function verifyRuntimeLaunch(
  options: VerifyRuntimeLaunchOptions
): Promise<VerificationReceipt> {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? (() => randomUUID());
  const launchSpec = options.launchSpec;
  const hostEnvironment = options.hostEnvironment ?? process.env;
  const runtimeSecretValues = options.runtimeSecretValues ?? {};
  const secrets = Object.values(runtimeSecretValues).filter(Boolean);
  const redactions: VerificationEvidenceRedactions = {
    secrets,
    environment: [
      ...new Set([
        ...evidenceEnvironmentValues(hostEnvironment),
        ...evidenceEnvironmentValues(launchSpec.environment.overrides, true)
      ])
    ]
  };
  const stages: VerificationStageResult[] = [];
  const codexRuntimeHome = launchSpec.agentKind === "codex"
    ? await prepareCodexRuntimeHome({
        environment: hostEnvironment,
        includeLocalAuth: launchSpec.runtime.providerKind === "inherited-local"
      })
    : undefined;
  const probeHostEnvironment = codexRuntimeHome?.environment ?? hostEnvironment;
  try {
    const installationStartedAt = now();
    options.onStageStart?.("installation", installationStartedAt);
    const installation = await verifyInstallation(
      launchSpec,
      probeHostEnvironment,
      options.signal,
      now,
      redactions
    );
    stages.push(installation);
    options.onStageComplete?.(installation);
    if (installation.status !== "passed") {
      const conversation = skippedStage("conversation", now, "Skipped because the CLI installation is not ready.");
      const task = skippedStage("task", now, "Skipped because the CLI installation is not ready.");
      stages.push(conversation, task);
      options.onStageComplete?.(conversation);
      options.onStageComplete?.(task);
    } else {
      let environment: NodeJS.ProcessEnv;
      const conversationStartedAt = now();
      options.onStageStart?.("conversation", conversationStartedAt);
      try {
        environment = await materializeRuntimeLaunchEnvironment(
          launchSpec,
          hostEnvironment,
          async (secretRef, secretRevision) => {
            const binding = launchSpec.environment.secretBindings.find(
              (entry) => entry.secretRef === secretRef && entry.secretRevision === secretRevision
            );
            return binding ? runtimeSecretValues[secretRef] : undefined;
          }
        );
        if (codexRuntimeHome) {
          environment = { ...environment, CODEX_HOME: codexRuntimeHome.runtimePath };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stages.push({
          stage: "conversation",
          status: "failed",
          startedAt: now(),
          durationMs: 0,
          errorCategory: classifyRuntimeVerificationFailure({ stage: "conversation", message }),
          summary: "The task-scoped Provider Secret is unavailable.",
          details: [cleanOutput(message, redactions)]
        });
        options.onStageComplete?.(stages[stages.length - 1]);
        const task = skippedStage("task", now, "Skipped because the Provider conversation could not start.");
        stages.push(task);
        options.onStageComplete?.(task);
        environment = {};
      }

      if (stages.length === 1) {
        const probeEnvironment = environment;
        redactions.environment = [
          ...new Set([
            ...redactions.environment,
            ...evidenceEnvironmentValues(probeEnvironment)
          ])
        ];
        const conversation = await verifyConversation({
          launchSpec,
          environment: probeEnvironment,
          signal: options.signal,
          now,
          redactions
        });
        stages.push(conversation);
        options.onStageComplete?.(conversation);
        if (conversation.status === "passed") {
          const taskStartedAt = now();
          options.onStageStart?.("task", taskStartedAt);
          const task = await verifyTask({
            launchSpec,
            repositoryPath: options.repositoryPath,
            environment: probeEnvironment,
            signal: options.signal,
            now,
            redactions
          });
          stages.push(task);
          options.onStageComplete?.(task);
        } else {
          const task = skippedStage("task", now, "Skipped because the real Provider conversation failed.");
          stages.push(task);
          options.onStageComplete?.(task);
        }
      }
    }
  } finally {
    await codexRuntimeHome?.cleanup();
  }

  const readiness = stages[0]?.status !== "passed"
    ? "not-installed"
    : stages[1]?.status !== "passed"
      ? "installed"
      : stages[2]?.status === "passed"
        ? "task-ready"
        : "blocked";
  return {
    schemaVersion: VERIFICATION_RECEIPT_SCHEMA_V1,
    receiptId: `verification-${createId()}`,
    createdAt: now(),
    launchSpecHash: launchSpec.launchSpecHash,
    profileId: launchSpec.profile.id,
    profileRevision: launchSpec.profile.revision,
    secretRevision: launchSpec.profile.secretRevision,
    installationFingerprint: launchSpec.installation.fingerprint,
    harnessSnapshotId: launchSpec.harnessSnapshotId,
    repositoryBaselineIdentity: launchSpec.repositoryBaselineIdentity,
    readiness,
    stages
  };
}
