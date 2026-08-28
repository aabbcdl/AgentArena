import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import { useWorkbench } from "../hooks/useWorkbench";
import type { Locale, RuntimeAgentKind, RuntimeProfile, RuntimeProfileMode } from "../types";
import { Icon, Notice, t } from "./ui";

interface ProviderEditorProps {
  locale: Locale;
  editing?: RuntimeProfile | null;
  onClose: () => void;
}

function defaultProtocol(agentKind: RuntimeAgentKind): string {
  return agentKind === "codex" ? "openai-responses" : "anthropic-messages";
}

function parseEnvironment(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid environment entry: ${line}`);
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!name || !value) throw new Error(`Invalid environment entry: ${line}`);
    result[name] = value;
  }
  return result;
}

interface ModelSettingsProps {
  locale: Locale;
  agentKind: RuntimeAgentKind;
  requestedModel: string;
  setRequestedModel: (value: string) => void;
  canonicalModelIdentity: string;
  setCanonicalModelIdentity: (value: string) => void;
  reasoningEffort: string;
  setReasoningEffort: (value: string) => void;
  localOverride?: boolean;
}

function ModelSettings({
  locale,
  agentKind,
  requestedModel,
  setRequestedModel,
  canonicalModelIdentity,
  setCanonicalModelIdentity,
  reasoningEffort,
  setReasoningEffort,
  localOverride = false
}: ModelSettingsProps) {
  return (
    <>
      <label class="field">
        <span>{localOverride
          ? (locale === "zh-CN" ? "模型覆盖（可选）" : "Model override (optional)")
          : (locale === "zh-CN" ? "请求模型" : "Requested model")}</span>
        <input value={requestedModel} onInput={(event) => setRequestedModel(event.currentTarget.value)} placeholder={agentKind === "codex" ? "gpt-5.6-luna" : "claude-sonnet-4-5"} />
      </label>
      <label class="field">
        <span>{locale === "zh-CN" ? "规范模型身份（用于公平比较）" : "Canonical model identity (for fair comparison)"}</span>
        <input value={canonicalModelIdentity} onInput={(event) => setCanonicalModelIdentity(event.currentTarget.value)} placeholder={locale === "zh-CN" ? "留空时使用请求模型" : "Leave empty to use requested model"} />
      </label>
      {agentKind === "codex" && (
        <label class="field">
          <span>{locale === "zh-CN" ? "思考强度（可选）" : "Reasoning effort (optional)"}</span>
          <select value={reasoningEffort} onChange={(event) => setReasoningEffort(event.currentTarget.value)}>
            <option value="">{locale === "zh-CN" ? "CLI 默认" : "CLI default"}</option>
            <option value="minimal">minimal</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="xhigh">xhigh</option>
            <option value="max">max</option>
          </select>
        </label>
      )}
    </>
  );
}

export function ProviderEditor({ locale, editing, onClose }: ProviderEditorProps) {
  const { saveRuntimeProfile, deleteRuntimeProfile, setNotice } = useWorkbench();
  const isEditing = Boolean(editing);
  const [name, setName] = useState(editing?.name ?? "");
  const [agentKind, setAgentKind] = useState<RuntimeAgentKind>(editing?.agentKind ?? "codex");
  const [mode, setMode] = useState<RuntimeProfileMode>(editing?.mode ?? "managed-provider");
  const [commandPath, setCommandPath] = useState(editing?.commandPath ?? "");
  const [baseUrl, setBaseUrl] = useState(editing?.provider?.baseUrl ?? "");
  const [protocol, setProtocol] = useState(editing?.provider?.protocol ?? defaultProtocol(editing?.agentKind ?? "codex"));
  const [requestedModel, setRequestedModel] = useState(editing?.provider?.requestedModel ?? "");
  const [canonicalModelIdentity, setCanonicalModelIdentity] = useState(editing?.provider?.canonicalModelIdentity ?? "");
  const [reasoningEffort, setReasoningEffort] = useState(editing?.provider?.reasoningEffort ?? "");
  const [haikuModel, setHaikuModel] = useState(editing?.provider?.modelMappings?.haiku ?? "");
  const [sonnetModel, setSonnetModel] = useState(editing?.provider?.modelMappings?.sonnet ?? "");
  const [opusModel, setOpusModel] = useState(editing?.provider?.modelMappings?.opus ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [secret, setSecret] = useState("");
  const [replaceEnvironment, setReplaceEnvironment] = useState(!isEditing);
  const [environmentText, setEnvironmentText] = useState("");
  const [confirmRisk, setConfirmRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  const protocols = useMemo(() => agentKind === "codex"
    ? [{ value: "openai-responses", label: "OpenAI Responses" }]
    : [
        { value: "anthropic-messages", label: "Anthropic Messages" },
        { value: "openai-chat-via-proxy", label: "OpenAI Chat via proxy" }
      ], [agentKind]);

  useEffect(() => {
    if (!protocols.some((option) => option.value === protocol)) {
      setProtocol(defaultProtocol(agentKind));
    }
  }, [agentKind, protocol, protocols]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    node?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
      if (event.key !== "Tab" || !node) return;
      const focusable = Array.from(node.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    node?.addEventListener("keydown", onKeyDown);
    return () => { node?.removeEventListener("keydown", onKeyDown); previous?.focus?.(); };
  }, [onClose]);

  const handleSave = async () => {
    if (!name.trim()) {
      setNotice({ kind: "warning", messageKey: "providerNameRequired" });
      return;
    }
    if (mode === "managed-provider" && (!baseUrl.trim() || !requestedModel.trim())) {
      setNotice({
        kind: "warning",
        message: locale === "zh-CN" ? "Managed Provider 必须填写 Base URL 和请求模型。" : "Managed Provider requires a Base URL and requested model."
      });
      return;
    }
    if (mode === "managed-provider" && !confirmRisk) {
      setNotice({ kind: "warning", messageKey: "providerConfirmBaseUrlRequired" });
      return;
    }

    setBusy(true);
    try {
      const mappings = agentKind === "claude-code"
        ? Object.fromEntries([
            ["haiku", haikuModel.trim()],
            ["sonnet", sonnetModel.trim()],
            ["opus", opusModel.trim()]
          ].filter((entry): entry is [string, string] => Boolean(entry[1])))
        : undefined;
      const payload: Record<string, unknown> = {
        ...(editing?.id ? { id: editing.id } : {}),
        name: name.trim(),
        agentKind,
        mode,
        commandPath: commandPath.trim() || undefined,
        notes: notes.trim() || undefined,
        riskFlags: mode === "managed-provider"
          ? ["third-party-provider", "user-managed-secret"]
          : [],
        ...(mode === "managed-provider"
          ? {
              provider: {
                baseUrl: baseUrl.trim(),
                protocol,
                requestedModel: requestedModel.trim(),
                canonicalModelIdentity: canonicalModelIdentity.trim() || undefined,
                modelIdentitySource: requestedModel.trim() || canonicalModelIdentity.trim() ? "declared" : "unknown",
                reasoningEffort: reasoningEffort.trim() || undefined,
                modelMappings: mappings && Object.keys(mappings).length > 0 ? mappings : undefined
              },
              _confirmBaseUrlRisk: true
            }
          : requestedModel.trim() || canonicalModelIdentity.trim() || reasoningEffort.trim()
            ? {
                provider: {
                  requestedModel: requestedModel.trim() || undefined,
                  canonicalModelIdentity: canonicalModelIdentity.trim() || undefined,
                  modelIdentitySource: "declared",
                  reasoningEffort: reasoningEffort.trim() || undefined
                }
              }
            : {}),
        ...(replaceEnvironment ? { extraEnv: parseEnvironment(environmentText) } : {}),
        ...(mode === "managed-provider" && secret.trim() ? { secret: secret.trim() } : {})
      };
      await saveRuntimeProfile(payload);
      setNotice({ kind: "success", messageKey: isEditing ? "providerUpdated" : "providerCreated" });
      onClose();
    } catch (error) {
      setNotice({ kind: "danger", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!editing?.id) return;
    setBusy(true);
    try {
      await deleteRuntimeProfile(editing.id);
      setNotice({ kind: "success", messageKey: "providerDeleted" });
      onClose();
    } catch (error) {
      setNotice({ kind: "danger", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="provider-editor" data-provider-editor="true" role="dialog" aria-modal="true" aria-labelledby={headingId} ref={dialogRef}>
      <div class="provider-editor-head">
        <div>
          <strong id={headingId}>{isEditing
            ? (locale === "zh-CN" ? "编辑运行配置" : "Edit runtime profile")
            : (locale === "zh-CN" ? "新增运行配置" : "Add runtime profile")}</strong>
          <small>{locale === "zh-CN" ? "仅影响 AgentArena 的验证与任务子进程" : "Applies only to AgentArena verification and task processes"}</small>
        </div>
        <button type="button" class="icon-button" onClick={onClose} aria-label={t(locale, "providerCancel")}><Icon name="cancel" /></button>
      </div>

      <div class="provider-editor-body">
        <label class="field">
          <span>{locale === "zh-CN" ? "配置名称" : "Profile name"}</span>
          <input value={name} onInput={(event) => setName(event.currentTarget.value)} placeholder={locale === "zh-CN" ? "例如 Codex + 内部 Provider" : "e.g. Codex + internal Provider"} />
        </label>
        <label class="field">
          <span>Harness</span>
          <select value={agentKind} disabled={isEditing} onChange={(event) => setAgentKind(event.currentTarget.value as RuntimeAgentKind)}>
            <option value="codex">Codex CLI</option>
            <option value="claude-code">Claude Code</option>
          </select>
        </label>
        <label class="field">
          <span>{locale === "zh-CN" ? "运行模式" : "Runtime mode"}</span>
          <select value={mode} onChange={(event) => setMode(event.currentTarget.value as RuntimeProfileMode)}>
            <option value="inherit-local">{locale === "zh-CN" ? "继承当前本地配置" : "Inherit current local setup"}</option>
            <option value="managed-provider">{locale === "zh-CN" ? "任务级 Managed Provider" : "Task-scoped Managed Provider"}</option>
          </select>
        </label>
        <label class="field">
          <span>{locale === "zh-CN" ? "命令路径（可选）" : "Command path (optional)"}</span>
          <input value={commandPath} onInput={(event) => setCommandPath(event.currentTarget.value)} placeholder={agentKind === "codex" ? "codex" : "claude"} />
        </label>

        {mode === "managed-provider" && (
          <>
            <label class="field">
              <span>Base URL</span>
              <input value={baseUrl} onInput={(event) => { setBaseUrl(event.currentTarget.value); setConfirmRisk(false); }} placeholder="https://provider.example/v1" />
            </label>
            <label class="field">
              <span>{locale === "zh-CN" ? "协议" : "Protocol"}</span>
              <select value={protocol} onChange={(event) => setProtocol(event.currentTarget.value)}>
                {protocols.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <ModelSettings
              locale={locale}
              agentKind={agentKind}
              requestedModel={requestedModel}
              setRequestedModel={setRequestedModel}
              canonicalModelIdentity={canonicalModelIdentity}
              setCanonicalModelIdentity={setCanonicalModelIdentity}
              reasoningEffort={reasoningEffort}
              setReasoningEffort={setReasoningEffort}
            />
            <label class="field">
              <span>{t(locale, "providerSecret")}</span>
              <input type="password" value={secret} autoComplete="new-password" onInput={(event) => setSecret(event.currentTarget.value)} placeholder={isEditing ? t(locale, "providerSecretPlaceholderEdit") : t(locale, "providerSecretPlaceholder")} />
            </label>
            {agentKind === "claude-code" && (
              <div class="provider-model-mappings">
                <span>{locale === "zh-CN" ? "Claude 模型映射（可选）" : "Claude model mappings (optional)"}</span>
                <div>
                  <input aria-label="Haiku model" value={haikuModel} onInput={(event) => setHaikuModel(event.currentTarget.value)} placeholder="Haiku" />
                  <input aria-label="Sonnet model" value={sonnetModel} onInput={(event) => setSonnetModel(event.currentTarget.value)} placeholder="Sonnet" />
                  <input aria-label="Opus model" value={opusModel} onInput={(event) => setOpusModel(event.currentTarget.value)} placeholder="Opus" />
                </div>
              </div>
            )}
            <label class="field-check">
              <input type="checkbox" checked={confirmRisk} onInput={(event) => setConfirmRisk(event.currentTarget.checked)} />
              <span>{t(locale, "providerConfirmBaseUrlRisk")}</span>
            </label>
          </>
        )}

        {mode === "inherit-local" && (
          <>
            <ModelSettings
              locale={locale}
              agentKind={agentKind}
              requestedModel={requestedModel}
              setRequestedModel={setRequestedModel}
              canonicalModelIdentity={canonicalModelIdentity}
              setCanonicalModelIdentity={setCanonicalModelIdentity}
              reasoningEffort={reasoningEffort}
              setReasoningEffort={setReasoningEffort}
              localOverride
            />
            <Notice kind="info">{locale === "zh-CN"
              ? "只保存模型和思考强度覆盖，不会修改 ~/.codex/config.toml，也不会切换 Provider。"
              : "Only model and reasoning overrides are saved. AgentArena will not edit ~/.codex/config.toml or switch Providers."}</Notice>
          </>
        )}

        <label class="field-check">
          <input type="checkbox" checked={replaceEnvironment} onInput={(event) => setReplaceEnvironment(event.currentTarget.checked)} />
          <span>{isEditing
            ? (locale === "zh-CN" ? "替换已保存的额外环境变量" : "Replace saved extra environment variables")
            : (locale === "zh-CN" ? "设置额外环境变量" : "Set extra environment variables")}</span>
        </label>
        {replaceEnvironment && (
          <label class="field provider-editor-wide">
            <span>{locale === "zh-CN" ? "额外环境变量（每行 KEY=value）" : "Extra environment (one KEY=value per line)"}</span>
            <textarea rows={3} value={environmentText} onInput={(event) => setEnvironmentText(event.currentTarget.value)} placeholder="PROVIDER_REGION=cn-east" />
          </label>
        )}
        {isEditing && !replaceEnvironment && editing?.extraEnvKeys.length ? (
          <Notice kind="info">{locale === "zh-CN"
            ? `将保留 ${editing.extraEnvKeys.length} 个已保存变量：${editing.extraEnvKeys.join(", ")}`
            : `Keeping ${editing.extraEnvKeys.length} saved variable(s): ${editing.extraEnvKeys.join(", ")}`}</Notice>
        ) : null}
        <label class="field provider-editor-wide">
          <span>{t(locale, "providerNotes")}</span>
          <textarea rows={2} value={notes} onInput={(event) => setNotes(event.currentTarget.value)} placeholder={t(locale, "providerNotesPlaceholder")} />
        </label>
      </div>

      <div class="provider-editor-actions">
        {isEditing && !editing?.isBuiltIn && (
          <button type="button" class="button danger" onClick={() => void handleDelete()} disabled={busy}>{t(locale, "providerDelete")}</button>
        )}
        <span class="spacer" />
        <button type="button" class="button ghost" onClick={onClose} disabled={busy}>{t(locale, "providerCancel")}</button>
        <button type="button" class="button primary" onClick={() => void handleSave()} disabled={busy}>{t(locale, "providerSave")}</button>
      </div>
    </div>
  );
}
