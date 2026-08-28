/**
 * @module launcher/module
 *
 * Launcher module for AgentArena web-report UI.
 *
 * Design principle: All multi-variant agents (Codex, Claude, Gemini, Aider,
 * Kilo, OpenCode) are driven by a VARIANT_CONFIGS array. Adding a new agent
 * only requires adding one entry to VARIANT_CONFIGS — no copy-paste needed.
 *
 * Each variant config defines:
 * - id:          unique key used in state and DOM data attributes
 * - baseAgentId: the adapter ID sent to the backend
 * - labelKey:    i18n key for the section heading
 * - descKey:     i18n key for the section description
 * - fields:      which input fields the variant card renders
 * - defaultModelPlaceholder: placeholder text for the model input
 */

export function safeExternalHref(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function isCommunityTaskPack(taskPack) {
  const declaredSource = taskPack?.source ?? taskPack?.metadata?.source;
  if (declaredSource === "community") return true;
  if (declaredSource === "official") return false;

  const repoSource = taskPack?.repoSource;
  return typeof repoSource === "string" && !repoSource.startsWith("builtin://");
}

export function claudeRuntimeModeDescription(profile, localText) {
  if ((profile?.kind ?? "official") === "official") {
    return localText(
      "使用当前本地 Claude Code 登录和个人配置。AgentArena 不主动修改这些配置，但 Claude Code 自身可能正常更新缓存、历史或登录状态。后台任务使用 --permission-mode dontAsk；需要交互授权的工具会被拒绝，不会启用全权限绕过。",
      "Uses the current local Claude Code login and personal configuration. AgentArena does not modify it, although Claude Code may normally update caches, history, or login state. Background tasks use --permission-mode dontAsk; tools that require interactive approval are denied and no full permission bypass is enabled."
    );
  }
  return localText(
    "这是旧页面的兼容模式：使用独立临时配置，不读取当前官方登录、个人规则、插件或 MCP。新的 Workbench RuntimeProfile 会改为继承正常 Harness，并只在任务进程覆盖 Provider。兼容模式的后台任务也使用 --permission-mode dontAsk，不启用全权限绕过。",
    "This is a legacy compatibility mode: it uses an isolated temporary configuration without the current official login, personal rules, plugins, or MCP. New Workbench RuntimeProfiles instead inherit the normal Harness and override only the task process Provider. Compatibility-mode background tasks also use --permission-mode dontAsk, without a full permission bypass."
  );
}

export function createLauncherModule(deps) {
  const {
    state,
    elements,
    t,
    localText,
    escapeHtml,
    setHidden,
    clientRandomId,
    providerDisplayName,
    formatElapsedDuration,
    fetchWithTimeout,
    apiFetch,
    handleApiError,
    baselineTaskWarning,
    summarizeTaskPrompt,
    summarizeJudges,
    translateDifficulty,
    applySingleRun,
    render
  } = deps;

  // -----------------------------------------------------------------------
  // Variant configuration registry — adding a new agent = one entry here
  // -----------------------------------------------------------------------

  /**
   * @typedef {Object} VariantConfig
   * @property {string} id - Unique key (used in state, DOM data-attributes, localStorage)
   * @property {string} baseAgentId - Adapter ID sent to the backend
   * @property {string} labelKey - i18n key for section heading (zh-CN)
   * @property {string} labelKeyEn - i18n key for section heading (en)
   * @property {string} descKey - i18n key for section description (zh-CN)
   * @property {string} descKeyEn - i18n key for section description (en)
   * @property {string} defaultModelPlaceholder - Placeholder for model input
   * @property {Array<'displayLabel'|'model'|'reasoningEffort'>} fields - Which fields to render
   * @property {boolean} hasReasoning - Whether to show reasoning effort field
   * @property {boolean} isClaude - Special handling for Claude provider system
   */

  /** @type {VariantConfig[]} */
  const VARIANT_CONFIGS = [
    {
      id: 'codex',
      baseAgentId: 'codex',
      labelKey: 'Codex 变体',
      labelKeyEn: 'Codex Variants',
      descKey: '',
      descKeyEn: '',
      defaultModelPlaceholder: 'gpt-5.4',
      fields: ['displayLabel', 'model', 'reasoningEffort'],
      hasReasoning: true,
      isClaude: false
    },
    {
      id: 'gemini',
      baseAgentId: 'gemini-cli',
      labelKey: 'Gemini CLI 变体',
      labelKeyEn: 'Gemini CLI Variants',
      descKey: 'Google 官方终端 agent，支持 JSON 输出和 token 用量报告。',
      descKeyEn: "Google's official terminal agent with JSON output and token usage reporting.",
      defaultModelPlaceholder: 'gemini-2.5-pro',
      fields: ['displayLabel', 'model'],
      hasReasoning: false,
      isClaude: false
    },
    {
      id: 'aider',
      baseAgentId: 'aider',
      labelKey: 'Aider 变体',
      labelKeyEn: 'Aider Variants',
      descKey: '开源终端 pair programming 工具，支持 Claude/GPT/Gemini 多种后端模型。',
      descKeyEn: 'Open-source terminal pair programming tool supporting Claude, GPT, Gemini, and more.',
      defaultModelPlaceholder: 'claude-sonnet-4-20250514',
      fields: ['displayLabel', 'model'],
      hasReasoning: false,
      isClaude: false
    },
    {
      id: 'kilo',
      baseAgentId: 'kilo-cli',
      labelKey: 'Kilo CLI 变体',
      labelKeyEn: 'Kilo CLI Variants',
      descKey: '新兴开源 agent，基于 portable core 构建，支持多种模型配置。',
      descKeyEn: 'Emerging open-source agent built on a portable core with multi-model support.',
      defaultModelPlaceholder: 'gpt-5.4',
      fields: ['displayLabel', 'model'],
      hasReasoning: false,
      isClaude: false
    },
    {
      id: 'opencode',
      baseAgentId: 'opencode',
      labelKey: 'OpenCode 变体',
      labelKeyEn: 'OpenCode Variants',
      descKey: '免费、多 provider 支持的开源终端 agent。',
      descKeyEn: 'Free, multi-provider open-source terminal agent.',
      defaultModelPlaceholder: 'gpt-5.4',
      fields: ['displayLabel', 'model'],
      hasReasoning: false,
      isClaude: false
    }
  ];

  // -----------------------------------------------------------------------
  // Generic variant helpers — work for ANY variant config
  // -----------------------------------------------------------------------

  /** Get the state key for a variant's array (e.g. state.launcherCodexVariants) */
  function variantStateKey(configId) {
    return `launcher${configId.charAt(0).toUpperCase() + configId.slice(1)}Variants`;
  }

  /** Get the DOM data attribute name (e.g. data-codex-variant-id) */
  function variantDataAttr(configId) {
    return `data-${configId}-variant-id`;
  }

  /** Get the role prefix for data-role attributes (e.g. "variant-" for codex, "gemini-variant-" for gemini) */
  function rolePrefix(configId) {
    return configId === 'codex' ? 'variant-' : `${configId}-variant-`;
  }

  /** Create a default variant for a given config */
  function defaultVariant(config) {
    const base = {
      id: clientRandomId(),
      enabled: false,
      displayLabel: config.labelKeyEn.replace(' Variants', ''),
      model: ''
    };
    if (config.hasReasoning) {
      base.reasoningEffort = '';
      base.source = 'unknown';
      base.verification = 'unknown';
    }
    return base;
  }

  // Special default for Codex which reads service info
  function defaultCodexVariant() {
    const defaults = state.serviceInfo?.codexDefaults ?? {};
    return {
      id: clientRandomId(),
      enabled: false,
      displayLabel: 'Codex CLI',
      model: '',
      reasoningEffort: '',
      source: defaults.source ?? 'unknown',
      verification: defaults.verification ?? 'unknown'
    };
  }

  // Special default for Claude (profile-driven)
  function defaultClaudeVariant(profile) {
    const model = profile?.primaryModel ?? '';
    const displayLabel =
      profile?.kind === "official"
        ? "Claude Code · Official"
        : `Claude Code · ${providerDisplayName(profile)}${model ? ` · ${model}` : ""}`;

    return {
      id: clientRandomId(),
      profileId: profile?.id ?? "claude-official",
      enabled: false,
      displayLabel,
      model,
      providerName: providerDisplayName(profile),
      providerKind: profile?.kind ?? "official",
      secretStored: Boolean(profile?.secretStored),
      isBuiltIn: Boolean(profile?.isBuiltIn)
    };
  }

  // -----------------------------------------------------------------------
  // Sync helpers
  // -----------------------------------------------------------------------

  function syncLauncherVariantsWithAdapters() {
    for (const config of VARIANT_CONFIGS) {
      const key = variantStateKey(config.id);
      if (state[key].length === 0) {
        state[key] = [config.id === 'codex' ? defaultCodexVariant() : defaultVariant(config)];
      }
    }
  }

  function syncClaudeVariantsWithProfiles() {
    const previousByProfileId = new Map(
      state.launcherClaudeVariants.map((variant) => [variant.profileId, variant])
    );

    state.launcherClaudeVariants = state.availableProviderProfiles.map((profile) => {
      const existing = previousByProfileId.get(profile.id);
      const base = existing ?? defaultClaudeVariant(profile);
      const fallbackLabel =
        profile.kind === "official"
          ? "Claude Code · Official"
          : `Claude Code · ${providerDisplayName(profile)}${base.model?.trim() || profile.primaryModel || "default"}`;

      return {
        ...base,
        profileId: profile.id,
        providerName: profile.name,
        providerKind: profile.kind,
        secretStored: Boolean(profile.secretStored),
        isBuiltIn: Boolean(profile.isBuiltIn),
        displayLabel: base.displayLabel?.trim() || fallbackLabel,
        model: base.model ?? profile.primaryModel ?? ""
      };
    });
  }

  // -----------------------------------------------------------------------
  // Phase label & selection summary
  // -----------------------------------------------------------------------

  function currentRunPhaseLabel() {
    if (!state.runStatus || state.runStatus.state !== "running") {
      return "";
    }
    const phase = t(`launcherPhases.${state.runStatus.phase ?? "starting"}`);
    if (!state.runStatus.startedAt) {
      return phase;
    }
    const elapsed = formatElapsedDuration(Date.now() - new Date(state.runStatus.startedAt).getTime());
    return t("launcherStatusRunningPhase", phase, elapsed);
  }

  function summarizeLauncherSelection(selectedTaskPack) {
    const allVariants = selectedLauncherVariants();
    const otherAgents = selectedLauncherAgents();
    const variantCount = allVariants.length + otherAgents.length;
    const taskTitle = selectedTaskPack?.title || localText("自定义任务包", "Custom task pack");
    const variantNames = [
      ...otherAgents.map((agentId) => state.availableAdapters.find((adapter) => adapter.id === agentId)?.title ?? agentId),
      ...allVariants.map((v) => v.displayLabel || v.baseAgentId)
    ];
    const selectionPreview = variantNames.slice(0, 3).join(", ");
    const extraCount = Math.max(variantNames.length - 3, 0);
    const preview =
      variantNames.length === 0
        ? localText("还没有选择 variant", "No variants selected")
        : `${selectionPreview}${extraCount > 0 ? ` +${extraCount}` : ""}`;

    return localText(
      `任务：${taskTitle} | 已选 ${variantCount} 个 variant | ${preview}`,
      `Task: ${taskTitle} | ${variantCount} variant(s) selected | ${preview}`
    );
  }

  // -----------------------------------------------------------------------
  // Config persistence
  // -----------------------------------------------------------------------

  function saveLauncherConfig() {
    try {
      const variantData = {};
      for (const config of VARIANT_CONFIGS) {
        const key = variantStateKey(config.id);
        const fields = ['enabled', 'displayLabel', 'model'];
        if (config.hasReasoning) fields.push('reasoningEffort');
        variantData[`${config.id}Variants`] = state[key].map((v) => {
          const entry = {};
          for (const f of fields) {
            entry[f] = v[f];
          }
          return entry;
        });
      }

      const config = {
        repoPath: elements.launcherRepoPath.value,
        taskPath: elements.launcherTaskPath.value,
        selectedTaskPackId: elements.launcherTaskSelect.value,
        outputPath: elements.launcherOutputPath.value,
        probeAuth: elements.launcherProbeAuth.checked,
        scoreMode: state.launcherScoreMode,
        globalModelOverride: state.launcherGlobalModelOverride,
        globalModelEnabled: state.launcherGlobalModelEnabled,
        globalModelAgentIds: state.launcherGlobalModelAgentIds,
        selectedAgentIds: selectedLauncherAgents(),
        ...variantData,
        claudeVariants: state.launcherClaudeVariants.map((v) => ({
          profileId: v.profileId,
          enabled: v.enabled,
          displayLabel: v.displayLabel,
          model: v.model
        }))
      };
      localStorage.setItem("agentarena.webReport.launcherConfig", JSON.stringify(config));
    } catch {
      // ignore localStorage failures
    }
  }

  function loadLauncherConfig() {
    try {
      const raw = localStorage.getItem("agentarena.webReport.launcherConfig");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // HTML rendering — generic variant cards
  // -----------------------------------------------------------------------

  function renderGenericVariantCard(config, variant) {
    const dataAttr = variantDataAttr(config.id);
    const rp = rolePrefix(config.id);
    const fields = [];
    const codexDefaults = config.id === 'codex' ? (state.serviceInfo?.codexDefaults ?? {}) : {};
    const modelPlaceholder = codexDefaults.effectiveModel ?? config.defaultModelPlaceholder;
    const reasoningPlaceholder = codexDefaults.effectiveReasoningEffort ?? 'low / medium / high';

    // Display label field
    if (config.fields.includes('displayLabel')) {
      fields.push(`
        <label class="field">
          <span>${escapeHtml(localText("显示名称", "Display Label"))}</span>
          <input data-role="${rp}label" type="text" value="${escapeHtml(variant.displayLabel)}" />
        </label>`);
    }

    // Model field
    if (config.fields.includes('model')) {
      fields.push(`
        <label class="field">
          <span>${escapeHtml(localText("模型", "Model"))}</span>
          <input data-role="${rp}model" type="text" value="${escapeHtml(variant.model ?? '')}" placeholder="${escapeHtml(modelPlaceholder)}" />
        </label>`);
    }

    // Reasoning effort field (Codex only)
    if (config.fields.includes('reasoningEffort') && config.hasReasoning) {
      fields.push(`
        <label class="field">
          <span>${escapeHtml(localText("推理等级", "Reasoning Effort"))}</span>
          <input data-role="${rp}reasoning" list="reasoning-levels" type="text" value="${escapeHtml(variant.reasoningEffort ?? '')}" placeholder="${escapeHtml(reasoningPlaceholder)}" />
        </label>`);
    }

    let metaHtml = '';
    if (config.hasReasoning && variant.source) {
      metaHtml = `<p class="muted">${escapeHtml(localText("默认来源", "Default source"))}: ${escapeHtml(variant.source)} | ${escapeHtml(localText("可信度", "Verification"))}: ${escapeHtml(variant.verification)}</p>`;
    }

    return `
      <div class="variant-card" ${dataAttr}="${escapeHtml(variant.id)}">
        <label class="checkbox">
          <input type="checkbox" data-role="${rp}enabled" ${variant.enabled ? "checked" : ""} />
          <span>${escapeHtml(localText(`启用这个 ${config.labelKeyEn.replace(' Variants', '')} variant`, `Enable this ${config.labelKeyEn.replace(' Variants', '')} variant`))}</span>
        </label>
        <div class="launcher-grid">
          ${fields.join('')}
        </div>
        ${metaHtml}
        <div class="inline-actions">
          <button type="button" class="btn-test-connection" data-role="${rp}test">${escapeHtml(t("testConnection"))}</button>
          <button type="button" class="variant-remove" data-role="${rp}remove">${escapeHtml(localText("删除这个 variant", "Remove variant"))}</button>
        </div>
      </div>
    `;
  }

  function renderGenericVariantSection(config) {
    const key = variantStateKey(config.id);
    const variants = state[key];
    const enabledCount = variants.filter(v => v.enabled).length;
    const sectionLabel = localText(config.labelKey, config.labelKeyEn);
    const descText = localText(config.descKey, config.descKeyEn);

    const variantCards = variants.map(v => renderGenericVariantCard(config, v)).join('');

    const addBtnLabel = localText(`新增 ${config.labelKeyEn.replace(' Variants', '')} variant`, `Add ${config.labelKeyEn.replace(' Variants', '')} variant`);

    let extraHtml = '';
    if (config.id === 'codex') {
      const codexDefaults = state.serviceInfo?.codexDefaults ?? {};
      const codexDefaultsText = localText(
        `当前默认：模型 ${codexDefaults.effectiveModel ?? "unknown"} | 推理 ${codexDefaults.effectiveReasoningEffort ?? "default"} | ${codexDefaults.verification ?? "unknown"} / ${codexDefaults.source ?? "unknown"}`,
        `Current default: model ${codexDefaults.effectiveModel ?? "unknown"} | reasoning ${codexDefaults.effectiveReasoningEffort ?? "default"} | ${codexDefaults.verification ?? "unknown"} / ${codexDefaults.source ?? "unknown"}`
      );
      extraHtml = `<p class="muted">${escapeHtml(codexDefaultsText)}</p>
        <p class="muted">${escapeHtml(localText(
          "模型和推理等级留空时，使用运行当下的本地 Codex 登录与配置；填写后只覆盖本次运行。",
          "Leave model and reasoning blank to use the current local Codex login and configuration at run time; filled values override only this run."
        ))}</p>
        <datalist id="reasoning-levels">
          <option value="low"></option>
          <option value="medium"></option>
          <option value="high"></option>
        </datalist>`;
    }

    return `
      <details class="launcher-section">
        <summary class="launcher-section-summary">${escapeHtml(sectionLabel)} · <span class="muted">${escapeHtml(localText(`${enabledCount} 个已启用`, `${enabledCount} enabled`))}</span></summary>
        ${descText ? `<p class="muted">${escapeHtml(descText)}</p>` : ''}
        ${extraHtml}
        ${variantCards}
        <div class="inline-actions" style="margin-top:12px">
          <button id="launcher-add-${config.id}-variant" type="button">${escapeHtml(addBtnLabel)}</button>
        </div>
      </details>
    `;
  }

  // -----------------------------------------------------------------------
  // Claude variant rendering (special: profile-driven, provider editor)
  // -----------------------------------------------------------------------

  function renderClaudeVariants() {
    const variants = state.launcherClaudeVariants;
    const enabledCount = variants.filter(v => v.enabled).length;

    const variantCards = variants.map((variant) => {
      const profile = state.availableProviderProfiles.find((entry) => entry.id === variant.profileId);
      const riskBadges = [];
      if (profile?.kind !== "official") {
        riskBadges.push(localText("第三方 Provider", "Third-party Provider"));
        riskBadges.push(localText("兼容模式", "Compatibility Mode"));
        riskBadges.push(localText("用户管理密钥", "User-managed Secret"));
      }

      return `
        <div class="variant-card" data-claude-variant-id="${escapeHtml(variant.id)}" data-profile-id="${escapeHtml(variant.profileId ?? "claude-official")}">
          <label class="checkbox">
            <input type="checkbox" data-role="claude-variant-enabled" ${variant.enabled ? "checked" : ""} />
            <span>${escapeHtml(localText("启用这个 Claude Code variant", "Enable this Claude Code variant"))}</span>
          </label>
          <div class="launcher-grid">
            <label class="field">
              <span>${escapeHtml(localText("显示名称", "Display Label"))}</span>
              <input data-role="claude-variant-label" type="text" value="${escapeHtml(variant.displayLabel)}" />
            </label>
            <label class="field">
              <span>${escapeHtml(localText("模型", "Model"))}</span>
              <input data-role="claude-variant-model" type="text" value="${escapeHtml(variant.model ?? "")}" placeholder="${escapeHtml(profile?.primaryModel ?? "model")}" />
            </label>
          </div>
          <p class="muted">${escapeHtml(localText("Provider", "Provider"))}: ${escapeHtml(profile?.name ?? variant.providerName ?? "Official")} | ${escapeHtml(localText("类型", "Kind"))}: ${escapeHtml(profile?.kind ?? variant.providerKind ?? "official")}</p>
          <p class="muted provider-mode-description">${escapeHtml(claudeRuntimeModeDescription(profile, localText))}</p>
          <div class="provider-status-row">
            <span class="provider-status-label">${escapeHtml(localText("密钥状态", "Secret"))}:</span>
            ${
              profile?.kind === "official"
                ? `<span class="provider-status-badge provider-status-official">
                    <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    ${escapeHtml(localText("官方登录态", "Official login"))}
                   </span>`
                : profile?.secretStored
                  ? `<span class="provider-status-badge provider-status-stored">
                      <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                      ${escapeHtml(localText("已配置", "Configured"))}
                     </span>`
                  : `<span class="provider-status-badge provider-status-missing">
                      <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      ${escapeHtml(localText("未配置", "Not configured"))}
                     </span>`
            }
          </div>
          ${riskBadges.length > 0 ? `<div class="badge-row">${riskBadges.map((badge) => `<span class="meaning-badge risk-badge">${escapeHtml(badge)}</span>`).join("")}</div>` : ""}
          <div class="inline-actions">
            <button type="button" class="btn-test-connection" data-role="claude-variant-test">${escapeHtml(t("testConnection"))}</button>
            ${
              profile?.isBuiltIn
                ? `<span class="muted">${escapeHtml(localText("官方内置 Provider", "Built-in official provider"))}</span>`
                : `<button type="button" data-role="provider-edit" data-profile-id="${escapeHtml(profile?.id ?? "claude-official")}">${escapeHtml(localText("编辑 Provider", "Edit Provider"))}</button>
                   <button type="button" data-role="provider-delete" data-profile-id="${escapeHtml(profile?.id ?? "")}">${escapeHtml(localText("删除 Provider", "Delete Provider"))}</button>`
            }
          </div>
        </div>
      `;
    }).join('');

    return { variantCards, enabledCount };
  }

  function renderProviderEditor() {
    if (!state.launcherProviderEditor) return '';

    const editor = state.launcherProviderEditor;
    return `
      <div class="provider-editor" data-provider-editor="true">
        <div class="panel-header">
          <h4>${escapeHtml(editor.id ? localText("编辑 Claude Provider", "Edit Claude Provider") : localText("新增 Claude Provider", "Add Claude Provider"))}</h4>
        </div>
        <p class="warning-text">${escapeHtml(
          localText(
            "第三方兼容层可能改变 Claude Code 行为。结果代表 Claude Code + 该 provider/profile 的表现，不是原生 AgentArena API agent。",
            "Third-party compatibility layers can change Claude Code behavior. Results represent \"Claude Code + this provider/profile\", not native AgentArena API agents."
          )
        )}</p>
        <div class="launcher-grid">
          <label class="field">
            <span>${escapeHtml(localText("Provider 名称", "Provider Name"))} <span class="field-required">${escapeHtml(localText("必填", "required"))}</span></span>
            <input data-role="provider-name" type="text" value="${escapeHtml(editor.name)}" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("类型", "Kind"))} <span class="field-required">${escapeHtml(localText("必填", "required"))}</span></span>
            <select data-role="provider-kind">
              <option value="anthropic-compatible" ${editor.kind === "anthropic-compatible" ? "selected" : ""}>${escapeHtml(localText("Anthropic 兼容", "Anthropic Compatible"))}</option>
              <option value="openai-proxy" ${editor.kind === "openai-proxy" ? "selected" : ""}>${escapeHtml(localText("OpenAI 代理", "OpenAI Proxy"))}</option>
            </select>
          </label>
          <label class="field">
            <span>${escapeHtml(localText("官网链接", "Homepage"))} <span class="field-optional">${escapeHtml(localText("选填", "optional"))}</span></span>
            <input data-role="provider-homepage" type="text" value="${escapeHtml(editor.homepage)}" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("Base URL", "Base URL"))} <span class="field-required">${escapeHtml(localText("必填", "required"))}</span></span>
            <input data-role="provider-base-url" type="text" value="${escapeHtml(editor.baseUrl)}" />
            <div class="base-url-warning" data-role="base-url-warning" style="display: none; margin-top: 8px; padding: 12px; background: var(--warning-soft, rgba(245, 158, 11, 0.12)); border: 1px solid var(--warning, #f59e0b); border-radius: 4px; color: var(--warning-light, #fbbf24);">
              <div style="display: flex; align-items: start; gap: 8px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0; margin-top: 2px;">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div style="flex: 1;">
                  <strong>${escapeHtml(localText("⚠️ 第三方 API 风险提示", "⚠️ Third-Party API Risk"))}</strong>
                  <p style="margin: 4px 0 0 0; font-size: 0.9em;">
                    ${escapeHtml(localText(
                      "此 Base URL 不在官方白名单中。您的 API Key 将被发送到第三方服务器。请确保您信任该服务提供商。",
                      "This Base URL is not in the official whitelist. Your API key will be sent to a third-party server. Please ensure you trust this service provider."
                    ))}
                  </p>
                  <p style="margin: 4px 0 0 0; font-size: 0.85em; opacity: 0.8;">
                    ${escapeHtml(localText(
                      "官方白名单：api.anthropic.com, api.openai.com, generativelanguage.googleapis.com, dashscope.aliyuncs.com",
                      "Official whitelist: api.anthropic.com, api.openai.com, generativelanguage.googleapis.com, dashscope.aliyuncs.com"
                    ))}
                  </p>
                </div>
              </div>
            </div>
          </label>
          <label class="field">
            <span>${escapeHtml(localText("API 格式", "API Format"))} <span class="field-required">${escapeHtml(localText("必填", "required"))}</span></span>
            <select data-role="provider-api-format">
              <option value="anthropic-messages" ${editor.apiFormat === "anthropic-messages" ? "selected" : ""}>${escapeHtml(localText("Anthropic Messages", "Anthropic Messages"))}</option>
              <option value="openai-chat-via-proxy" ${editor.apiFormat === "openai-chat-via-proxy" ? "selected" : ""}>${escapeHtml(localText("OpenAI Chat 代理", "OpenAI Chat via Proxy"))}</option>
            </select>
          </label>
          <label class="field">
            <span>${escapeHtml(localText("主模型", "Primary Model"))} <span class="field-required">${escapeHtml(localText("必填", "required"))}</span></span>
            <input data-role="provider-primary-model" type="text" value="${escapeHtml(editor.primaryModel)}" placeholder="gpt-5.4" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("Thinking 模型", "Thinking Model"))} <span class="field-optional">${escapeHtml(localText("选填", "optional"))}</span></span>
            <input data-role="provider-thinking-model" type="text" value="${escapeHtml(editor.thinkingModel)}" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("默认 Haiku 模型", "Default Haiku Model"))} <span class="field-optional">${escapeHtml(localText("选填", "optional"))}</span></span>
            <input data-role="provider-haiku-model" type="text" value="${escapeHtml(editor.defaultHaikuModel)}" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("默认 Sonnet 模型", "Default Sonnet Model"))} <span class="field-optional">${escapeHtml(localText("选填", "optional"))}</span></span>
            <input data-role="provider-sonnet-model" type="text" value="${escapeHtml(editor.defaultSonnetModel)}" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("默认 Opus 模型", "Default Opus Model"))} <span class="field-optional">${escapeHtml(localText("选填", "optional"))}</span></span>
            <input data-role="provider-opus-model" type="text" value="${escapeHtml(editor.defaultOpusModel)}" />
          </label>
          <label class="field field-wide">
            <span>${escapeHtml(localText("备注", "Notes"))} <span class="field-optional">${escapeHtml(localText("选填", "optional"))}</span></span>
            <input data-role="provider-notes" type="text" value="${escapeHtml(editor.notes)}" />
          </label>
          <label class="field field-wide">
            <span>${escapeHtml(localText("额外环境变量 JSON", "Extra Env JSON"))} <span class="field-optional">${escapeHtml(localText("选填", "optional"))}</span></span>
            <textarea data-role="provider-extra-env" rows="6">${escapeHtml(editor.extraEnv)}</textarea>
          </label>
          <label class="field field-wide">
            <span>${escapeHtml(localText("API Key / Token", "API Key / Token"))} <span class="field-optional">${escapeHtml(localText("选填，留空不修改", "optional"))}</span></span>
            <input data-role="provider-secret" type="password" value="${escapeHtml(editor.secret)}" placeholder="${escapeHtml(localText("留空则不修改当前已保存的 secret", "Leave blank to keep the currently stored secret"))}" />
          </label>
        </div>
        <label class="checkbox">
          <input data-role="provider-write-common-config" type="checkbox" ${editor.writeCommonConfig ? "checked" : ""} />
          <span>${escapeHtml(localText("写入通用 Claude Code 配置", "Write common Claude Code config"))}</span>
        </label>
        <div class="inline-actions">
          <button type="button" data-role="provider-save">${escapeHtml(localText("保存 Provider", "Save Provider"))}</button>
          <button type="button" data-role="provider-cancel">${escapeHtml(localText("取消", "Cancel"))}</button>
        </div>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Build step indicator & progress
  // -----------------------------------------------------------------------

  function buildStepIndicatorHtml() {
    const phase = state.runStatus?.phase ?? "starting";
    const phaseOrder = ["starting", "preflight", "benchmark", "report"];
    const phaseLabels = {
      starting: localText("启动", "Start"),
      preflight: localText("预检", "Preflight"),
      benchmark: localText("运行", "Benchmark"),
      report: localText("报告", "Report")
    };
    const currentIndex = phaseOrder.indexOf(phase);

    const parts = [];
    parts.push('<div class="launcher-steps">');
    phaseOrder.forEach((p, i) => {
      const cls = i < currentIndex ? "done" : i === currentIndex ? "active" : "";
      parts.push('<div class="launcher-step ' + cls + '"><span class="launcher-step-dot"></span>' + escapeHtml(phaseLabels[p]) + '</div>');
      if (i < phaseOrder.length - 1) {
        const connectorCls = i < currentIndex ? " done" : "";
        parts.push('<div class="launcher-step-connector' + connectorCls + '"></div>');
      }
    });
    parts.push('</div>');
    return parts.join("");
  }

  function renderLauncherProgress() {
    const isVisible = state.runInProgress || (state.runStatus?.logs?.length ?? 0) > 0;
    setHidden(elements.launcherProgress, !isVisible);
    if (!isVisible) return;

    const phase = state.runStatus?.phase ?? "starting";
    elements.launcherProgressTitle.innerHTML = `${escapeHtml(t("launcherProgressTitle"))}${state.runInProgress ? buildStepIndicatorHtml() : ""}`;
    const currentAgent = state.runStatus?.currentDisplayLabel || state.runStatus?.currentVariantId || state.runStatus?.currentAgentId;
    elements.launcherCurrentAgent.textContent = currentAgent
      ? t("launcherCurrentAgentLabel", currentAgent)
      : t("launcherCurrentAgentIdle");

    // Build progress bar + per-agent status from snapshot
    const snap = state.runStatus?.snapshot;
    const total = snap?.total ?? 0;
    const finished = snap?.finished ?? 0;
    const running = snap?.running ?? [];
    const failed = snap?.failed ?? 0;
    const pct = total > 0 ? Math.round((finished / total) * 100) : 0;

    const progressBar = total > 0 ? `
      <div class="launcher-progress-bar-container">
        <div class="launcher-progress-bar" style="width:${pct}%"></div>
        <span class="launcher-progress-bar-text">${finished}/${total} · ${running.length} ${localText("运行中", "running")} · ${failed} ${localText("失败", "failed")}</span>
      </div>` : "";

    // Per-agent status cards (from running list in snapshot)
    const STALL_MS = 45000;
    const now = Date.now();
    const agentCards = running.map((variantId) => {
      const activity = state.agentActivity[variantId];
      const stalled = activity?.ts ? (now - activity.ts) > STALL_MS : false;
      const label = variantId; // fallback if no display label available
      return `<span class="agent-chip ${stalled ? "agent-chip-stalled" : "agent-chip-running"}" title="${stalled ? localText("已停滞", "Stalled") : localText("运行中", "Running")}">${escapeHtml(label)}</span>`;
    }).join("");

    const agentChips = agentCards ? `<div class="launcher-agent-chips">${agentCards}</div>` : "";

    const logs = Array.isArray(state.runStatus?.logs) ? state.runStatus.logs : [];
    if (logs.length === 0 && state.runInProgress) {
      const phaseLabel = t(`launcherPhases.${phase}`);
      elements.launcherLogList.innerHTML = `
        ${progressBar}
        ${agentChips}
        <div class="launcher-progress-hero">
          <div class="launcher-progress-spinner"></div>
          <div class="launcher-progress-hero-text">
            <strong>${escapeHtml(phaseLabel)}</strong>
            <span class="muted">${escapeHtml(localText("正在启动，请稍候…", "Starting up, please wait…"))}</span>
          </div>
        </div>`;
      return;
    }

    if (logs.length === 0) {
      elements.launcherLogList.innerHTML = progressBar + agentChips;
      return;
    }

    elements.launcherLogList.innerHTML = progressBar + agentChips + logs
      .slice()
      .reverse()
      .map((entry) => {
        const logPhase = t(`launcherPhases.${entry.phase ?? "starting"}`);
        const actor = entry.displayLabel ? `${escapeHtml(entry.displayLabel)} · ` : "";
        return `
          <article class="launcher-log-entry">
            <div class="launcher-log-head">
              <span class="status-badge status-${escapeHtml(entry.phase ?? "starting")}">${escapeHtml(logPhase)}</span>
              <span class="muted">${escapeHtml(new Date(entry.timestamp).toLocaleTimeString())}</span>
            </div>
            <p>${actor}${escapeHtml(entry.message)}</p>
          </article>
        `;
      })
      .join("");
  }

  // -----------------------------------------------------------------------
  // Provider editor state
  // -----------------------------------------------------------------------

  function createProviderEditorState(profile = null) {
    return {
      id: profile?.id ?? "",
      name: profile?.name ?? "",
      kind: profile?.kind ?? "anthropic-compatible",
      homepage: profile?.homepage ?? "",
      baseUrl: profile?.baseUrl ?? "",
      apiFormat: profile?.apiFormat ?? "anthropic-messages",
      primaryModel: profile?.primaryModel ?? "",
      thinkingModel: profile?.thinkingModel ?? "",
      defaultHaikuModel: profile?.defaultHaikuModel ?? "",
      defaultSonnetModel: profile?.defaultSonnetModel ?? "",
      defaultOpusModel: profile?.defaultOpusModel ?? "",
      notes: profile?.notes ?? "",
      extraEnv: profile?.extraEnv ? JSON.stringify(profile.extraEnv, null, 2) : "{}",
      writeCommonConfig: profile?.writeCommonConfig ?? true,
      secret: ""
    };
  }

  function openProviderEditor(profileId = null) {
    const profile = profileId
      ? state.availableProviderProfiles.find((entry) => entry.id === profileId) ?? null
      : null;
    state.launcherProviderEditor = createProviderEditorState(profile);
  }

  function syncProviderEditorStateFromDom() {
    if (!state.launcherProviderEditor) return;

    const editor = elements.launcherAgents.querySelector("[data-provider-editor='true']");
    if (!editor) return;

    const readValue = (selector) => editor.querySelector(selector)?.value ?? "";
    const readChecked = (selector) => editor.querySelector(selector)?.checked ?? false;
    state.launcherProviderEditor = {
      ...state.launcherProviderEditor,
      name: readValue('[data-role="provider-name"]'),
      kind: readValue('[data-role="provider-kind"]') || state.launcherProviderEditor.kind,
      homepage: readValue('[data-role="provider-homepage"]'),
      baseUrl: readValue('[data-role="provider-base-url"]'),
      apiFormat: readValue('[data-role="provider-api-format"]') || state.launcherProviderEditor.apiFormat,
      primaryModel: readValue('[data-role="provider-primary-model"]'),
      thinkingModel: readValue('[data-role="provider-thinking-model"]'),
      defaultHaikuModel: readValue('[data-role="provider-haiku-model"]'),
      defaultSonnetModel: readValue('[data-role="provider-sonnet-model"]'),
      defaultOpusModel: readValue('[data-role="provider-opus-model"]'),
      notes: readValue('[data-role="provider-notes"]'),
      extraEnv: readValue('[data-role="provider-extra-env"]') || "{}",
      writeCommonConfig: readChecked('[data-role="provider-write-common-config"]'),
      secret: readValue('[data-role="provider-secret"]')
    };
  }

  // -----------------------------------------------------------------------
  // Task pack helpers
  // -----------------------------------------------------------------------

  function taskPackI18n(taskPack, field) {
    const lang = state.language;
    const i18nData = taskPack?.i18n?.[lang];
    if (i18nData?.[field]) return i18nData[field];
    return taskPack?.[field] ?? taskPack?.metadata?.[field] ?? "";
  }

  function renderTaskPackDetail(taskPack) {
    if (!taskPack) {
      setHidden(elements.taskPackDetail, true);
      return;
    }

    const difficultyColors = { easy: "status-success", medium: "status-partial", hard: "status-fail" };
    const diffBadge = taskPack.difficulty
      ? `<span class="task-pack-badge ${difficultyColors[taskPack.difficulty] || ""}">${escapeHtml(translateDifficulty(taskPack.difficulty))}</span>`
      : "";
    const tags = (taskPack.tags ?? []).map((tag) => `<span class="task-pack-tag">${escapeHtml(tag)}</span>`).join("");
    const judgeCount = Array.isArray(taskPack.judges) ? taskPack.judges.length : 0;
    const repoTypes = (taskPack.repoTypes ?? []).join(", ") || "generic";
    const title = taskPackI18n(taskPack, "title") || taskPack.title;
    const desc = taskPackI18n(taskPack, "description") || taskPack.description || taskPack.objective || "";
    const diff = taskPackI18n(taskPack, "differentiator") || taskPack.differentiator;

    const isCommunity = isCommunityTaskPack(taskPack);
    const communityWarning = isCommunity
      ? `<div class="validation-msg validation-warning" style="margin-top:8px;padding:8px 12px;border-radius:4px;background:var(--warning-soft, rgba(245, 158, 11, 0.12));border:1px solid var(--warning, #f59e0b);color:var(--warning-light, #fbbf24);font-size:0.9em;">
          ⚠️ ${escapeHtml(localText(
            "社区任务包可能包含任意命令。请仅运行来自可信来源的任务包。",
            "Community task packs may contain arbitrary commands. Only run packs from trusted sources."
          ))}
        </div>`
      : "";

    // Compatibility indicator
    const compat = taskPack.compatibility;
    let compatHtml = "";
    if (compat) {
      const compatColors = {
        compatible: { bg: "rgba(16, 185, 129, 0.12)", border: "#10b981", color: "#34d399", icon: "✅" },
        warning: { bg: "rgba(245, 158, 11, 0.12)", border: "#f59e0b", color: "#fbbf24", icon: "⚠️" },
        incompatible: { bg: "rgba(239, 68, 68, 0.12)", border: "#ef4444", color: "#f87171", icon: "❌" },
        unknown: { bg: "rgba(107, 114, 128, 0.12)", border: "#6b7280", color: "#9ca3af", icon: "🔍" }
      };
      const style = compatColors[compat.status] ?? compatColors.unknown;
      const statusLabel = {
        compatible: localText("兼容当前仓库", "Compatible with current repo"),
        warning: localText("可能不适用 — 部分前提条件缺失", "May not work — missing prerequisites"),
        incompatible: localText("不兼容 — 语言/框架不匹配", "Incompatible — wrong language/framework"),
        unknown: localText("未检测兼容性", "Compatibility not checked")
      };
      const failedDetails = (compat.failedChecks ?? [])
        .filter((c) => c.status === "fail")
        .slice(0, 3)
        .map((c) => `<li>${escapeHtml(c.label)}: ${escapeHtml(c.message)}</li>`)
        .join("");
      compatHtml = `
        <div style="margin-top:8px;padding:8px 12px;border-radius:4px;background:${style.bg};border:1px solid ${style.border};color:${style.color};font-size:0.9em;">
          ${style.icon} ${escapeHtml(statusLabel[compat.status] ?? statusLabel.unknown)}
          ${compat.summary ? `<div style="margin-top:4px;font-size:0.85em;opacity:0.85;">${escapeHtml(compat.summary)}</div>` : ""}
          ${failedDetails ? `<ul style="margin:4px 0 0 16px;padding:0;font-size:0.85em;opacity:0.85;">${failedDetails}</ul>` : ""}
        </div>`;
    }

    elements.taskPackDetail.innerHTML = `
      <div class="task-pack-header">
        <strong>${escapeHtml(title)}</strong>
        <div class="task-pack-badges">${diffBadge}${tags}</div>
      </div>
      <p class="task-pack-desc">${escapeHtml(desc)}</p>
      ${diff ? `<p class="task-pack-diff"><span class="task-pack-label">${escapeHtml(localText("区分度", "Differentiator"))}</span> ${escapeHtml(diff)}</p>` : ""}
      <div class="task-pack-meta">
        <span>${escapeHtml(localText("适用", "Repo"))}: ${escapeHtml(repoTypes)}</span>
        <span>${escapeHtml(localText("检查项", "Judges"))}: ${judgeCount}</span>
      </div>
      ${compatHtml}
      ${communityWarning}
    `;
    setHidden(elements.taskPackDetail, false);
  }

  // -----------------------------------------------------------------------
  // Smart idle hint — show only what's actually missing
  // -----------------------------------------------------------------------

  function getSmartIdleHint() {
    const selectedTaskPack = state.availableTaskPacks.find((tp) => tp.path === elements.launcherTaskPath.value);
    const isBuiltinTaskPack = selectedTaskPack?.repoSource?.startsWith("builtin://");
    const hasRepo = isBuiltinTaskPack || elements.launcherRepoPath.value.trim().length > 0;
    const hasPack = elements.launcherTaskPath.value.trim().length > 0;
    const hasAgent = selectedLauncherVariants().length > 0;
    const missing = [];
    if (!hasPack) missing.push(localText("选择任务包", "select a task pack"));
    if (!hasRepo) missing.push(localText("填写仓库路径", "set repository path"));
    if (!hasAgent) missing.push(localText("启用至少 1 个 Agent", "enable at least 1 agent"));
    if (missing.length === 0) return localText("准备就绪，可以开始跑分", "Ready to run");
    return localText(`还差一步：${missing[0]}`, `Almost ready: ${missing[0]}`);
  }

  function renderLauncher() {
    setHidden(elements.launcherPanel, false);
    const info = state.serviceInfo || {};

    // Save current task pack selection before re-render
    const savedTaskPath = elements.launcherTaskSelect?.value || elements.launcherTaskPath?.value || "";

    // Restore saved config once on first render
    if (!state._launcherConfigRestored) {
      state._launcherConfigRestored = true;
      const saved = loadLauncherConfig();
      if (saved) {
        elements.launcherRepoPath.value = saved.repoPath || info.repoPath || "";
        elements.launcherOutputPath.value = saved.outputPath || info.defaultOutputPath || "";
        elements.launcherTaskPath.value = saved.taskPath || "";
        elements.launcherProbeAuth.checked = Boolean(saved.probeAuth);
        state.launcherSelectedAgentIds = [];
        state.launcherScoreMode = saved.scoreMode || "practical";
        state.launcherGlobalModelOverride = saved.globalModelOverride || "";
        state.launcherGlobalModelEnabled = saved.globalModelEnabled || false;
        state.launcherGlobalModelAgentIds = saved.globalModelAgentIds || [];

        // Restore generic variants
        for (const config of VARIANT_CONFIGS) {
          const savedKey = `${config.id}Variants`;
          const stateKey = variantStateKey(config.id);
          if (saved[savedKey]?.length) {
            state[stateKey] = saved[savedKey].map((sv) => ({
              ...(config.id === 'codex' ? defaultCodexVariant() : defaultVariant(config)),
              enabled: sv.enabled ?? false,
              displayLabel: sv.displayLabel ?? config.labelKeyEn.replace(' Variants', ''),
              model: sv.model ?? "",
              ...(sv.reasoningEffort !== undefined ? { reasoningEffort: sv.reasoningEffort } : {})
            }));
          } else {
            state[stateKey] = [config.id === 'codex' ? defaultCodexVariant() : defaultVariant(config)];
          }
        }

        syncClaudeVariantsWithProfiles();

        if (saved.claudeVariants?.length) {
          for (const sv of saved.claudeVariants) {
            const match = state.launcherClaudeVariants.find((v) => v.profileId === sv.profileId);
            if (match) {
              match.enabled = sv.enabled ?? false;
              match.displayLabel = sv.displayLabel || match.displayLabel;
              match.model = sv.model ?? match.model;
            }
          }
        }
      } else {
        elements.launcherRepoPath.value = info.repoPath || "";
        elements.launcherOutputPath.value = info.defaultOutputPath || "";
        for (const config of VARIANT_CONFIGS) {
          state[variantStateKey(config.id)] = [config.id === 'codex' ? defaultCodexVariant() : defaultVariant(config)];
        }
        syncClaudeVariantsWithProfiles();
        syncLauncherVariantsWithAdapters();
      }

      elements.launcherRepoPath.value = elements.launcherRepoPath.value || info.repoPath || "";
      elements.launcherOutputPath.value = elements.launcherOutputPath.value || info.defaultOutputPath || "";
      for (const config of VARIANT_CONFIGS) {
        const stateKey = variantStateKey(config.id);
        if (state[stateKey].length === 0) {
          state[stateKey] = [config.id === 'codex' ? defaultCodexVariant() : defaultVariant(config)];
        }
      }
      syncClaudeVariantsWithProfiles();
      syncLauncherVariantsWithAdapters();
    }

    // Task pack dropdown
    const difficultyOrder = { easy: 0, medium: 1, hard: 2 };
    const grouped = { compatible: [], warning: [], incompatible: [], unknown: [] };
    for (const tp of state.availableTaskPacks) {
      const compatStatus = tp.compatibility?.status ?? "unknown";
      const key = grouped[compatStatus] ? compatStatus : "unknown";
      grouped[key].push(tp);
    }
    // Within each group, sub-sort by difficulty then title
    for (const arr of Object.values(grouped)) {
      arr.sort((a, b) => {
        const da = difficultyOrder[a.difficulty] ?? 9;
        const db = difficultyOrder[b.difficulty] ?? 9;
        if (da !== db) return da - db;
        return (taskPackI18n(a, "title") || a.title).localeCompare(taskPackI18n(b, "title") || b.title);
      });
    }

    const customOption = `<option value="">${escapeHtml(t("taskPackCustom"))}</option>`;
    const compatLabels = {
      compatible: localText("✅ 兼容", "✅ Compatible"),
      warning: localText("⚠️ 可能不适用", "⚠️ May Not Work"),
      incompatible: localText("❌ 不兼容", "❌ Incompatible"),
      unknown: localText("🔍 未检测", "🔍 Unchecked")
    };
    const hasAnyCompatibilityInfo = state.availableTaskPacks.some((tp) => tp.compatibility);
    const builtinBadge = t("builtinRepoBadge") || "Built-in";
    const optionHtml = [customOption];

    // If we have compatibility info, group by compatibility first
    if (hasAnyCompatibilityInfo) {
      for (const compatKey of ["compatible", "warning", "unknown", "incompatible"]) {
        const packs = grouped[compatKey];
        if (packs.length === 0) continue;
        optionHtml.push(`<optgroup label="${escapeHtml(compatLabels[compatKey])} (${packs.length})">`);
        for (const tp of packs) {
          const tpTitle = taskPackI18n(tp, "title") || tp.title;
          const badge = tp.repoSource?.startsWith("builtin://") ? ` [${escapeHtml(builtinBadge)}]` : "";
          const diffBadge = tp.difficulty ? ` (${escapeHtml(translateDifficulty(tp.difficulty))})` : "";
          optionHtml.push(`<option value="${escapeHtml(tp.path)}">${escapeHtml(tpTitle)}${diffBadge}${badge}</option>`);
        }
        optionHtml.push(`</optgroup>`);
      }
    } else {
      // Fallback: group by difficulty
      const groupLabels = { easy: t("difficultyEasy") || "简单", medium: t("difficultyMedium") || "中等", hard: t("difficultyHard") || "困难", other: t("difficultyOther") || "其他" };
      const groupedByDiff = { easy: [], medium: [], hard: [], other: [] };
      for (const tp of state.availableTaskPacks) {
        const key = tp.difficulty && groupedByDiff[tp.difficulty] ? tp.difficulty : "other";
        groupedByDiff[key].push(tp);
      }
      for (const arr of Object.values(groupedByDiff)) {
        arr.sort((a, b) => (taskPackI18n(a, "title") || a.title).localeCompare(taskPackI18n(b, "title") || b.title));
      }
      for (const diffKey of ["easy", "medium", "hard", "other"]) {
        const packs = groupedByDiff[diffKey];
        if (packs.length === 0) continue;
        optionHtml.push(`<optgroup label="${escapeHtml(groupLabels[diffKey])} (${packs.length})">`);
        for (const tp of packs) {
          const tpTitle = taskPackI18n(tp, "title") || tp.title;
          const badge = tp.repoSource?.startsWith("builtin://") ? ` [${escapeHtml(builtinBadge)}]` : "";
          optionHtml.push(`<option value="${escapeHtml(tp.path)}">${escapeHtml(tpTitle)}${badge}</option>`);
        }
        optionHtml.push(`</optgroup>`);
      }
    }

    if (elements.launcherTaskSelect) {
      elements.launcherTaskSelect.innerHTML = optionHtml.join("");
    }

    // Restore the task select value — try exact match first, then by ID
    const currentTaskPath = savedTaskPath || elements.launcherTaskPath.value;
    if (!currentTaskPath && info.defaultTaskPath) {
      elements.launcherTaskPath.value = info.defaultTaskPath;
      elements.launcherTaskSelect.value = info.defaultTaskPath;
    } else if (currentTaskPath) {
      const matching = state.availableTaskPacks.find((taskPack) => taskPack.path === currentTaskPath);
      if (matching) {
        elements.launcherTaskSelect.value = matching.path;
      } else {
        // Path doesn't match any known task pack — keep custom path mode
        elements.launcherTaskSelect.value = "";
      }
    } else {
      // No task path set — default to first available task pack
      const firstPack = state.availableTaskPacks?.[0];
      if (firstPack) {
        elements.launcherTaskPath.value = firstPack.path;
        elements.launcherTaskSelect.value = firstPack.path;
      }
    }

    const selectedTaskPackPath = elements.launcherTaskSelect.value || elements.launcherTaskPath.value;
    const selectedTaskPack = state.availableTaskPacks.find((taskPack) => taskPack.path === selectedTaskPackPath) ?? null;
    renderTaskPackDetail(selectedTaskPack);

    // Task pack path summary — hide full path for official packs
    const taskPackSummary = document.getElementById("task-pack-summary");
    const taskPackShortName = document.getElementById("task-pack-short-name");
    if (taskPackSummary && taskPackShortName) {
      const isCustom = !elements.launcherTaskSelect.value;
      taskPackSummary.style.display = isCustom ? "none" : "flex";
      elements.launcherTaskPath.style.display = isCustom ? "block" : "none";
      if (!isCustom && selectedTaskPack) {
        taskPackShortName.textContent = selectedTaskPack.title || selectedTaskPack.id || selectedTaskPackPath.split(/[\\/]/).pop();
      }
    }

    // Real adapters (non-demo, non-variant-managed)
    const variantAgentIds = new Set(VARIANT_CONFIGS.map(c => c.baseAgentId));
    variantAgentIds.add('claude-code');
    const allRealAdapters = state.availableAdapters.filter(
      (adapter) => adapter.kind !== "demo" && !variantAgentIds.has(adapter.id)
    );

    // Filter to only show installed agents
    const realAdapters = state.installedAgents && state.installedAgents.size > 0
      ? allRealAdapters.filter(adapter => {
          const checkResult = state.installedAgents.get(adapter.id);
          return checkResult && checkResult.installed;
        })
      : allRealAdapters; // Show all if detection not yet complete

    // Count variant-managed agents that are installed
    const installedVariantCount = state.installedAgents
      ? Array.from(state.installedAgents.entries()).filter(([id, info]) => info.installed && variantAgentIds.has(id)).length
      : 0;

    const debugAdapters = state.availableAdapters.filter((adapter) => adapter.kind === "demo");

    // Task summary
    const taskSummary = selectedTaskPack
      ? (() => {
          const tpDesc = taskPackI18n(selectedTaskPack, "description") || selectedTaskPack.description || selectedTaskPack.objective || "";
          const tpObj = taskPackI18n(selectedTaskPack, "objective") || selectedTaskPack.objective || "n/a";
          const tpJR = taskPackI18n(selectedTaskPack, "judgeRationale") || selectedTaskPack.judgeRationale || "n/a";
          const tpDiff = taskPackI18n(selectedTaskPack, "differentiator") || selectedTaskPack.differentiator;
          return `
        <details class="launcher-section">
          <summary class="launcher-section-summary">${escapeHtml(localText("任务说明", "Task Info"))}${selectedTaskPack.difficulty ? ` · <span class="status-badge status-${escapeHtml(selectedTaskPack.difficulty)}">${escapeHtml(translateDifficulty(selectedTaskPack.difficulty))}</span>` : ""} · ${escapeHtml(tpDesc)}</summary>
          ${tpDiff ? `<p class="muted"><strong>${escapeHtml(localText("区分度", "Differentiator"))}:</strong> ${escapeHtml(tpDiff)}</p>` : ""}
          <p class="muted"><strong>${escapeHtml(localText("目标", "Objective"))}:</strong> ${escapeHtml(tpObj)}</p>
          <p class="muted"><strong>${escapeHtml(localText("Judge 依据", "Judge Rationale"))}:</strong> ${escapeHtml(tpJR)}</p>
          <p class="muted"><strong>${escapeHtml(localText("适用仓库", "Repo Types"))}:</strong> ${escapeHtml(
              (selectedTaskPack.repoTypes ?? []).join(", ") || "generic"
            )}</p>
          <p class="muted"><strong>${escapeHtml(localText("Prompt 摘要", "Prompt Summary"))}:</strong> ${escapeHtml(
              summarizeTaskPrompt(selectedTaskPack.prompt)
            )}</p>
          <p class="muted"><strong>${escapeHtml(localText("Judge 检查项", "Judge Checks"))}:</strong> ${escapeHtml(
              summarizeJudges(selectedTaskPack)
            )}</p>
          <p class="warning-text">${escapeHtml(
            selectedTaskPack.id === "official-repo-health"
              ? baselineTaskWarning({ id: selectedTaskPack.id })
              : localText("按任务目标解读这次 benchmark。", "Interpret this benchmark in the context of the task objective.")
          )}</p>
        </details>
      `;
      })()
      : "";

    // Claude section (special)
    const { variantCards: claudeCards, enabledCount: claudeEnabledCount } = renderClaudeVariants();
    const providerEditor = renderProviderEditor();

    // Build the full agents HTML
    const openSections = new Set();
    elements.launcherAgents.querySelectorAll("details.launcher-section").forEach((d) => {
      if (d.open) {
        const summary = d.querySelector("summary");
        if (summary) openSections.add(summary.textContent.trim().split(" ·")[0]);
      }
    });

    // Generate generic variant sections
    const genericSections = VARIANT_CONFIGS.map(config => renderGenericVariantSection(config)).join('');

    // Build list of enabled variants for global model selector
    const enabledVariantsForGlobalModel = [];

    // Generic variants
    for (const config of VARIANT_CONFIGS) {
      const stateKey = variantStateKey(config.id);
      for (const variant of state[stateKey].filter(v => v.enabled)) {
        const variantId = `${config.id}-${variant.id}`;
        const label = variant.displayLabel.trim() || config.labelKeyEn.replace(' Variants', '');
        enabledVariantsForGlobalModel.push({ id: variantId, label, baseAgentId: config.baseAgentId });
      }
    }

    // Claude variants
    for (const variant of state.launcherClaudeVariants.filter(v => v.enabled)) {
      const variantId = `claude-${variant.profileId}`;
      const label = variant.displayLabel.trim() || `Claude Code · ${variant.providerName ?? "Official"}`;
      enabledVariantsForGlobalModel.push({ id: variantId, label, baseAgentId: "claude-code" });
    }

    // Other agents
    for (const agentId of selectedLauncherAgents()) {
      const adapter = state.availableAdapters.find(a => a.id === agentId);
      const label = adapter?.title ?? agentId;
      enabledVariantsForGlobalModel.push({ id: `agent-${agentId}`, label, baseAgentId: agentId });
    }

    const globalModelAgentCheckboxes = enabledVariantsForGlobalModel.map(v => {
      const checked = state.launcherGlobalModelAgentIds.includes(v.id) ? 'checked' : '';
      return `<label class="field" style="display: flex; align-items: center; gap: 8px; margin: 4px 0;">
        <input type="checkbox" data-global-model-agent-id="${escapeHtml(v.id)}" ${checked} style="width: auto;" />
        <span>${escapeHtml(v.label)}</span>
      </label>`;
    }).join('');

    elements.launcherAgents.innerHTML = `
      ${taskSummary}
      <div class="launcher-section" style="${state.launcherGlobalModelEnabled ? '' : 'padding-bottom: 8px;'}">
        <h4>${escapeHtml(localText("全局模型覆盖", "Global Model Override"))}</h4>
        <p class="muted" style="display: ${state.launcherGlobalModelEnabled ? 'block' : 'none'};">${escapeHtml(localText("启用后，选中的 Agent 将使用此模型（优先级高于各变体配置）。", "When enabled, selected agents use this model (overrides individual variant configs)."))}</p>
        <label class="field" style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <input id="launcher-global-model-enabled" type="checkbox" ${state.launcherGlobalModelEnabled ? 'checked' : ''} style="width: auto;" />
          <span>${escapeHtml(localText("启用全局模型覆盖", "Enable global model override"))}</span>
        </label>
        <div id="launcher-global-model-input-row" style="display: ${state.launcherGlobalModelEnabled ? 'block' : 'none'};">
          <label class="field">
            <span>${escapeHtml(localText("全局模型", "Global Model"))}</span>
            <input id="launcher-global-model" type="text" value="${escapeHtml(state.launcherGlobalModelOverride)}" placeholder="${escapeHtml(localText("例如: claude-opus-4-6, gpt-5.4", "e.g. claude-opus-4-6, gpt-5.4"))}" />
          </label>
        </div>
        ${state.launcherGlobalModelEnabled && enabledVariantsForGlobalModel.length > 0 ? `
          <div style="margin-top: 12px; padding: 12px; background: var(--surface-tertiary); border-radius: 6px;">
            <p style="margin: 0 0 8px; font-weight: 600; font-size: 0.9em;">${escapeHtml(localText("选择应用全局模型的 Agent:", "Select agents to apply global model:"))}</p>
            ${globalModelAgentCheckboxes}
          </div>
        ` : ''}
      </div>
      <div class="launcher-section">
        <h4>${escapeHtml(localText("选择参赛 Agent", "Select Agents"))}</h4>
        <p class="muted">${escapeHtml(localText("勾选要参与对比的 Agent。", "Check the agents you want to compare."))}</p>
        ${realAdapters.length === 0
          ? installedVariantCount > 0
            ? `<p class="muted" style="padding: 12px 16px; background: var(--surface-secondary); border-radius: 8px; margin: 12px 0; font-size: 0.9em;">
                ${escapeHtml(localText(
                  `展开下方折叠区，启用想参与跑分的 Agent 配置。已检测到 ${installedVariantCount} 个 Agent。`,
                  `Expand the sections below to enable agents for benchmarking. ${installedVariantCount} agent(s) detected.`
                ))}
              </p>`
            : `<div class="empty-state" style="padding: 16px; text-align: center; background: var(--surface-secondary); border-radius: 8px; margin: 12px 0;">
              <p style="margin: 0 0 8px; font-size: 0.95em; color: var(--text-secondary);">
                <strong>${escapeHtml(localText("未检测到已安装的 Agent", "No installed agents detected"))}</strong>
              </p>
              <p style="margin: 0 0 12px; font-size: 0.85em; color: var(--text-muted);">
                ${escapeHtml(localText(
                  "需要先安装至少一个 Agent CLI 工具。",
                  "Install at least one Agent CLI tool first."
                ))}
              </p>
              <details style="text-align: left; max-width: 600px; margin: 0 auto; font-size: 0.8em;">
                <summary style="cursor: pointer; color: var(--text-muted); font-weight: 600;">${escapeHtml(localText("查看安装方式", "Show install instructions"))}</summary>
                <div style="margin-top: 8px;">
                  <code style="display: block; padding: 6px 10px; background: var(--surface-tertiary); border-radius: 4px; margin: 4px 0; font-size: 0.9em;">npm install -g @anthropic-ai/claude-code</code>
                  <code style="display: block; padding: 6px 10px; background: var(--surface-tertiary); border-radius: 4px; margin: 4px 0; font-size: 0.9em;">npm install -g @openai/codex</code>
                  <code style="display: block; padding: 6px 10px; background: var(--surface-tertiary); border-radius: 4px; margin: 4px 0; font-size: 0.9em;">npm install -g @google/gemini-cli</code>
                </div>
              </details>
                <div style="margin: 12px 0; padding: 12px; background: var(--surface-tertiary); border-radius: 6px;">
                  <p style="margin: 0 0 8px; font-weight: 600;">🔧 ${escapeHtml(localText("其他工具:", "Other tools:"))}</p>
                  <ul style="margin: 4px 0; padding-left: 20px; line-height: 1.6;">
                    <li><strong>GitHub Copilot</strong>: <code>gh extension install github/gh-copilot</code></li>
                    <li><strong>OpenCode</strong>: <a href="https://opencode.ai/download" target="_blank" rel="noopener">opencode.ai/download</a></li>
                    <li><strong>Qwen Code</strong>: <a href="https://github.com/QwenLM/Qwen3.6" target="_blank" rel="noopener">github.com/QwenLM/Qwen3.6</a></li>
                    <li><strong>Augment Code</strong>: <a href="https://www.augmentcode.com" target="_blank" rel="noopener">augmentcode.com</a> (${escapeHtml(localText("企业版", "Enterprise"))})</li>
                    <li><strong>Kilo CLI</strong>: ${escapeHtml(localText("查看官方文档", "See official docs"))}</li>
                  </ul>
                </div>
                <p style="margin: 12px 0 8px; color: var(--text-muted); font-size: 0.9em;">
                  💡 ${escapeHtml(localText(
                    "安装完成后，点击「重新检测」按钮刷新状态。",
                    "After installation, click 'Re-detect' to refresh status."
                  ))}
                </p>
              </div>
              <div class="launcher-actions" style="margin-top: 16px;">
                <button type="button" class="btn btn-secondary" id="detect-all-agents">${escapeHtml(localText("重新检测", "Re-detect"))}</button>
              </div>
            </div>`
          : `<div class="checkbox-grid">
              ${realAdapters
                .map((adapter) => {
                  const checked = state.launcherSelectedAgentIds.includes(adapter.id) ? "checked" : "";
                  const detectInfo = state.installedAgents?.get(adapter.id);
                  const versionBadge = detectInfo?.version ? ` <span style="font-size:0.75em;color:var(--text-muted);background:var(--surface-tertiary);padding:1px 6px;border-radius:4px;">v${escapeHtml(detectInfo.version)}</span>` : "";
                  return `
                    <div class="checkbox-item">
                      <label class="checkbox">
                        <input type="checkbox" data-role="real-agent" value="${escapeHtml(adapter.id)}" ${checked} />
                        <span>${escapeHtml(adapter.title)}${versionBadge}</span>
                      </label>
                    </div>
                  `;
                })
                .join("")}
            </div>
            ${(() => {
              const uninstalled = (state.installGuides || []).filter(g => {
                const info = state.installedAgents?.get(g.id);
                return info && !info.installed;
              });
              if (uninstalled.length === 0) return "";
              const platform = navigator.platform?.toLowerCase()?.includes("win") ? "windows" : navigator.platform?.toLowerCase()?.includes("mac") ? "macos" : "linux";
              return `<details style="margin-top:12px;font-size:0.85em;">
                <summary style="cursor:pointer;color:var(--text-secondary);font-weight:600;">
                  ${escapeHtml(localText("📦 未安装的 Agent 及安装方法", "📦 Uninstalled Agents & Install Commands"))} (${uninstalled.length})
                </summary>
                <div style="margin-top:8px;display:grid;gap:8px;">
                  ${uninstalled.map(g => {
                    const cmds = g.install?.[platform] || g.install?.all || {};
                    const entries = Object.entries(cmds).filter(([k]) => k !== "WARNING" && k !== "note");
                    const warnings = g.warnings || [];
                    const postInstall = g.postInstall || [];
                    const homepageHref = safeExternalHref(g.homepage);
                    return `<div style="padding:10px;background:var(--surface-secondary);border-radius:6px;border-left:3px solid var(--text-muted);">
                      <div style="font-weight:600;margin-bottom:6px;">${escapeHtml(g.displayName)}${homepageHref ? ` &middot; <a href="${escapeHtml(homepageHref)}" target="_blank" rel="noopener" style="font-weight:400;font-size:0.9em;">${escapeHtml(localText("官网", "Homepage"))}</a>` : ""}</div>
                      ${warnings.map(w => `<div style="color:var(--warning,orange);font-size:0.85em;margin-bottom:4px;">⚠ ${escapeHtml(w)}</div>`).join("")}
                      ${entries.map(([label, cmd]) => `<div style="display:flex;align-items:center;gap:6px;margin:3px 0;"><span style="color:var(--text-muted);min-width:80px;font-size:0.85em;">${escapeHtml(label)}:</span><code style="flex:1;background:var(--surface-tertiary);padding:2px 6px;border-radius:3px;font-size:0.85em;word-break:break-all;">${escapeHtml(cmd)}</code><button type="button" class="btn-copy-install" data-copy="${escapeHtml(cmd)}" style="padding:2px 8px;font-size:0.8em;cursor:pointer;border:1px solid var(--border);border-radius:3px;background:var(--surface);white-space:nowrap;" title="${escapeHtml(localText("复制命令", "Copy command"))}">📋</button></div>`).join("")}
                      ${postInstall.length > 0 ? `<div style="margin-top:6px;font-size:0.8em;color:var(--text-muted);">${postInstall.map(p => escapeHtml(p)).join("<br>")}</div>` : ""}
                    </div>`;
                  }).join("")}
                </div>
              </details>`;
            })()}
            <div class="launcher-actions" style="margin-top: 12px;">
              <button type="button" class="btn btn-secondary" id="detect-all-agents">${escapeHtml(localText("重新检测", "Re-detect"))}</button>
              <span class="muted" style="font-size: 0.85em;">${escapeHtml(localText("检测新安装的 Agent CLI", "Detect newly installed Agent CLIs"))}</span>
            </div>`
        }
      </div>
      <details class="launcher-section">
        <summary class="launcher-section-summary">${escapeHtml(localText("Claude Code 变体", "Claude Code Variants"))} · <span class="muted">${escapeHtml(localText(`${claudeEnabledCount} 个已启用`, `${claudeEnabledCount} enabled`))}</span></summary>
        <div class="launcher-info-box" style="margin-bottom:12px;padding:12px;border-radius:8px;background:var(--surface-secondary);border-left:3px solid var(--accent);">
          <p style="margin:0 0 8px;font-size:var(--text-sm);"><strong>${escapeHtml(localText("💡 关于 Claude Provider", "About Claude Provider"))}</strong></p>
          <ul style="margin:0;padding-left:20px;font-size:var(--text-xs);color:var(--text-secondary);line-height:1.6;">
            <li>${escapeHtml(localText(
              '“Official”（官方）：使用 Claude Code 官方登录态。需要先在终端运行 claude login 登录，之后 Benchmark 会自动复用登录状态，不需要填写 API Key。',
              '“Official”: Uses your official Claude Code login. Run claude login in a terminal first, then the benchmark reuses it automatically. No API key is needed.'
            ))}</li>
            <li>${escapeHtml(localText(
              '第三方 Provider：如果你修改了 Claude Code 的配置文件（如 .claude/settings.json 指向第三方代理），或者想直接使用 API Key，请点下方「新增 Claude Provider」添加第三方供应商。',
              'Third-party Provider: If your Claude Code configuration points to a proxy, or you want to use an API key directly, click “Add Claude Provider” below.'
            ))}</li>
          </ul>
        </div>
        <p class="muted">${escapeHtml(localText(
          "同一套 Claude Code harness 下的不同 provider/profile 变体。",
          "Provider-switched Claude Code variants under the same harness."
        ))}</p>
        ${info.riskNotice ? `<p class="warning-text">${escapeHtml(info.riskNotice)}</p>` : ""}
        ${claudeCards || `<p class="empty-state">${escapeHtml(localText("还没有可用的 Claude Provider。", "No Claude provider profiles available yet."))}</p>`}
        ${providerEditor}
        <div class="inline-actions" style="margin-top:12px">
          <button id="launcher-add-provider" type="button">${escapeHtml(localText("新增 Claude Provider", "Add Claude Provider"))}</button>
        </div>
      </details>
      ${genericSections}
      <details class="launcher-section">
        <summary class="launcher-section-summary">${escapeHtml(localText("调试用 Agent（默认不选）", "Debug Agents (not selected by default)"))}</summary>
        <p class="muted">${escapeHtml(localText(
          "Demo Fast / Thorough / Budget 只是内置的模拟 Agent，用来验证流水线和 UI，不代表真实模型能力。",
          "Demo Fast / Thorough / Budget are built-in synthetic adapters for validating the pipeline and UI. They do not represent real model capability."
        ))}</p>
        <div class="checkbox-grid">
          ${debugAdapters
            .map((adapter) => {
              const checked = state.launcherSelectedAgentIds.includes(adapter.id) ? "checked" : "";
              return `
                <label class="checkbox">
                  <input type="checkbox" data-role="debug-agent" value="${escapeHtml(adapter.id)}" ${checked} />
                  <span>${escapeHtml(adapter.title)}</span>
                </label>
              `;
            })
            .join("")}
        </div>
      </details>
    `;

    // Restore open sections
    elements.launcherAgents.querySelectorAll("details.launcher-section").forEach((d) => {
      const summary = d.querySelector("summary");
      if (summary && openSections.has(summary.textContent.trim().split(" ·")[0])) {
        d.open = true;
      }
    });

    // Disable run button when validation has errors or run in progress
    const validationMessages = validateLauncher();
    const hasErrors = validationMessages.some(m => m.level === "error");
    elements.launcherRun.disabled = state.runInProgress || hasErrors;
    elements.launcherCompactSummary.textContent = state.runInProgress
      ? (currentRunPhaseLabel() || t("launcherStatusRunning"))
      : summarizeLauncherSelection(selectedTaskPack);
    if (state.runInProgress) {
      elements.launcherCompactSummary.style.color = "var(--accent)";
      elements.launcherCompactSummary.style.fontWeight = "600";
    } else {
      elements.launcherCompactSummary.style.color = "";
      elements.launcherCompactSummary.style.fontWeight = "";
    }
    elements.launcherToggle.textContent = state.launcherExpanded
      ? localText("收起设置", "Hide Setup")
      : localText("展开设置", "Show Setup");
    setHidden(elements.launcherBody, !state.launcherExpanded);
    elements.launcherStatus.textContent = state.runInProgress
      ? currentRunPhaseLabel() || t("launcherStatusRunning")
      : state.notice ?? getSmartIdleHint();
    if (state.runInProgress) {
      elements.launcherStatus.classList.add("running");
    } else {
      elements.launcherStatus.classList.remove("running");
    }
    renderLauncherProgress();
  }

  // -----------------------------------------------------------------------
  // Service detection & polling
  // -----------------------------------------------------------------------

  async function detectService() {
    try {
      // Load core endpoints (must all succeed)
      const [infoResponse, adaptersResponse, runStatusResponse] = await Promise.all([
        apiFetch("/api/ui-info"),
        apiFetch("/api/adapters"),
        apiFetch("/api/run-status", { cache: "no-store" })
      ]);
      if (!infoResponse.ok || !adaptersResponse.ok || !runStatusResponse.ok) {
        return;
      }

      state.serviceInfo = await infoResponse.json();
      const allAdapters = await adaptersResponse.json();

      // Filter out IDE adapters (cursor, copilot, windsurf) - kept in backend for future use
      // These IDE adapters have poor automation support and are hidden from UI
      // Trae is also hidden due to poor usability
      const hiddenAdapterIds = new Set(['cursor', 'copilot', 'windsurf', 'trae']);
      state.availableAdapters = allAdapters.filter(adapter => !hiddenAdapterIds.has(adapter.id));

      // Fetch task packs with repo path for compatibility filtering
      const repoPath = state.serviceInfo?.repoPath ?? "";
      const taskPacksUrl = repoPath ? `/api/taskpacks?repoPath=${encodeURIComponent(repoPath)}` : "/api/taskpacks";
      try {
        const taskPacksResponse = await apiFetch(taskPacksUrl);
        if (taskPacksResponse.ok) {
          state.availableTaskPacks = await taskPacksResponse.json();
        } else {
          // Fallback: fetch without compatibility info
          const fallbackResponse = await apiFetch("/api/taskpacks");
          if (fallbackResponse.ok) {
            state.availableTaskPacks = await fallbackResponse.json();
          }
        }
      } catch {
        state.availableTaskPacks = [];
      }

      state.runStatus = await runStatusResponse.json();

      // Load provider profiles separately (may fail with 401 if no token)
      try {
        const providerProfilesResponse = await apiFetch("/api/provider-profiles");
        if (providerProfilesResponse.ok) {
          state.availableProviderProfiles = await providerProfilesResponse.json();
        }
      } catch {
        // Provider profiles are optional for initial load
      }

      syncClaudeVariantsWithProfiles();
      state.runInProgress = state.runStatus?.state === "running";
      if (state.runInProgress) {
        startRunStatusPolling();
      } else {
        stopRunStatusPolling();
      }

      // Check agent installation status on startup
      await checkInstalledAgents();
    } catch (error) {
      console.error("detectService failed", error);
      state.notice = localText(
        "本地服务初始化失败，请检查 /api/ui-info 和浏览器控制台。",
        "Local service bootstrap failed. Check /api/ui-info and the browser console."
      );
      stopRunStatusPolling();
      state.serviceInfo = null;
      state.availableAdapters = [];
      state.availableTaskPacks = [];
      state.availableProviderProfiles = [];
      state.runInProgress = false;
      state.runStatus = null;
    }

    // Service bootstrap only changes launcher/service state. If a report was
    // loaded while the async probes were in flight, a full render here would
    // replace its comparison DOM and detach elements currently being used by
    // the user (or by an accessibility/browser interaction). Keep the loaded
    // report stable and refresh only the launcher in that case.
    if (state.run) {
      renderLauncher();
    } else {
      render();
    }
  }

  async function checkInstalledAgents() {
    if (!state.availableAdapters || state.availableAdapters.length === 0) {
      state.installedAgents = new Map();
      state.installGuides = [];
      return;
    }

    // Fetch install guides in parallel with detection
    try {
      const guidesResponse = await apiFetch("/api/install-guides");
      if (guidesResponse.ok) {
        state.installGuides = await guidesResponse.json();
      }
    } catch {
      state.installGuides = [];
    }

    // Use the EchoBird-style agent detection endpoint (preferred)
    try {
      const detectionResponse = await apiFetch("/api/agent-detection");
      if (detectionResponse.ok) {
        const detectionResults = await detectionResponse.json();
        const results = new Map();
        for (const r of detectionResults) {
          results.set(r.id, {
            installed: r.installed,
            status: r.installed ? "ready" : "missing",
            summary: r.detail || (r.installed ? ("v" + r.version) : "Not installed"),
            version: r.version,
            configExists: r.configExists,
            configFilesFound: r.configFilesFound,
            configFilesMissing: r.configFilesMissing,
            installGuide: r.installGuide,
          });
        }
        state.installedAgents = results;
        return;
      }
    } catch {
      // Fall through to legacy preflight detection
    }

    // Fallback: legacy preflight-based detection
    const variantAgentIds = new Set(VARIANT_CONFIGS.map(c => c.baseAgentId));
    variantAgentIds.add('claude-code');
    const realAdapters = state.availableAdapters.filter(
      (adapter) => adapter.kind !== "demo" && !variantAgentIds.has(adapter.id)
    );

    const results = new Map();
    const checks = realAdapters.map(async (adapter) => {
      try {
        const response = await apiFetch("/api/preflight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseAgentId: adapter.id, displayLabel: adapter.title })
        });
        if (response.ok) {
          const result = await response.json();
          const installed = result.status === "ready" || result.status === "unverified";
          results.set(adapter.id, { installed, status: result.status, summary: result.summary });
        } else {
          results.set(adapter.id, { installed: false, status: "error", summary: null });
        }
      } catch {
        results.set(adapter.id, { installed: false, status: "error", summary: null });
      }
    });
    await Promise.all(checks);
    state.installedAgents = results;
  }

  async function pollRunStatus() {
    if (!state.serviceInfo) return;
    const requestSeq = ++state.runStatusRequestSeq;

    try {
      const response = await apiFetch("/api/run-status", { cache: "no-store" });
      if (!response.ok) return;
      const runStatus = await response.json();
      if (requestSeq !== state.runStatusRequestSeq) return;

      // Update per-agent activity from snapshot (if present)
      if (runStatus?.snapshot) {
        const snap = runStatus.snapshot;
        for (const [variantId, ts] of Object.entries(snap.lastActivityByAgent ?? {})) {
          state.agentActivity[variantId] = { ts };
        }
      }

      state.runStatus = runStatus;
      if (state.runStatus?.state === "done") {
        stopRunStatusPolling();
        const result = state.runStatus.result;
        state.runStatus = null;
        state.runInProgress = false;
        if (result?.run) {
          state.notice = t("launcherStatusDone", result.run.task.title);
          state.launcherExpanded = false;
          applySingleRun(result.run, result.markdown);
        }
        render();
        return;
      }
      if (state.runStatus?.state === "error") {
        stopRunStatusPolling();
        const rawError = state.runStatus.error || localText("未知错误", "Unknown error");
        // Wrap raw technical errors in user-friendly context
        const friendlyError = localText(
          `Benchmark 失败：${rawError}`,
          `Benchmark failed: ${rawError}`
        );
        state.runStatus = null;
        state.runInProgress = false;
        state.notice = t("launcherStatusError", friendlyError);
        state.errorDetail = rawError;
        render();
        return;
      }
      if (state.runStatus?.state !== "running" && state.runStatus?.state !== "idle" && state.runStatusPollTimer) {
        stopRunStatusPolling();
      }
    } catch {
      if (requestSeq === state.runStatusRequestSeq) {
        state.runStatus = null;
      }
    }

    renderLauncher();
  }

  function stopRunStatusPolling() {
    if (state.runStatusPollTimer) {
      clearInterval(state.runStatusPollTimer);
      state.runStatusPollTimer = null;
    }
  }

  function startRunStatusPolling() {
    stopRunStatusPolling();
    void pollRunStatus();
    // Try SSE stream first; if it connects, we stop polling and let the
    // stream drive updates. If SSE fails, fall back to 1s polling.
    void tryStartRunStream();
    state.runStatusPollTimer = window.setInterval(() => {
      // Only poll if SSE is not active
      if (!state.streamClient || state.streamClient.transport !== "sse") {
        void pollRunStatus();
      }
    }, 1000);
  }

  /**
   * Attempt to connect to the SSE /api/run-stream endpoint.
   * On success: sets state.streamClient and stops polling.
   * On failure: silently falls back to polling (no error shown to user).
   */
  async function tryStartRunStream() {
    try {
      const token = sessionStorage.getItem("agentarena-auth-token") ?? "";
      const streamUrl = `/api/run-stream?token=${encodeURIComponent(token)}`;
      const eventSource = new EventSource(streamUrl);

      let sseActive = false;
      const pollFallbackTimer = window.setInterval(() => {
        // If no SSE event received within 3s, fall back to polling
        if (!sseActive) {
          console.warn("[AgentArena] SSE connect timeout, falling back to polling");
          eventSource.close();
          state.streamClient = null;
          window.clearInterval(pollFallbackTimer);
        }
      }, 3000);

      eventSource.addEventListener("snapshot", (ev) => {
        sseActive = true;
        window.clearInterval(pollFallbackTimer);
        try {
          const data = JSON.parse(ev.data);
          state.runStatus = data;
          renderLauncher();
        } catch { /* ignore malformed */ }
      });

      eventSource.addEventListener("progress", (ev) => {
        sseActive = true;
        window.clearInterval(pollFallbackTimer);
        try {
          const data = JSON.parse(ev.data);
          // Merge progress into runStatus
          if (state.runStatus) {
            state.runStatus.phase = data.phase ?? state.runStatus.phase;
            state.runStatus.currentAgentId = data.agentId ?? state.runStatus.currentAgentId;
            state.runStatus.currentVariantId = data.variantId ?? state.runStatus.currentVariantId;
            state.runStatus.currentDisplayLabel = data.displayLabel ?? state.runStatus.currentDisplayLabel;
            state.runStatus.snapshot = data.snapshot ?? state.runStatus.snapshot;
            if (data.snapshot?.lastActivityByAgent) {
              for (const [vid, ts] of Object.entries(data.snapshot.lastActivityByAgent)) {
                state.agentActivity[vid] = { ts: ts };
              }
            }
          }
          renderLauncher();
        } catch { /* ignore malformed */ }
      });

      eventSource.addEventListener("activity", (ev) => {
        sseActive = true;
        try {
          const data = JSON.parse(ev.data);
          const vid = data.variantId;
          if (vid) {
            // Append to agentLogs ring buffer (cap 200 lines in browser)
            if (!state.agentLogs[vid]) state.agentLogs[vid] = [];
            state.agentLogs[vid].push(`[${data.stream}] ${data.line}`);
            if (state.agentLogs[vid].length > 200) state.agentLogs[vid].shift();
            state.agentActivity[vid] = { line: data.line, ts: Date.now() };
          }
          renderLauncher();
        } catch { /* ignore malformed */ }
      });

      eventSource.addEventListener("done", () => {
        window.clearInterval(pollFallbackTimer);
        eventSource.close();
        state.streamClient = null;
        // Final poll to get the result
        void pollRunStatus().then(() => render());
      });

      eventSource.onerror = () => {
        window.clearInterval(pollFallbackTimer);
        eventSource.close();
        state.streamClient = null;
        // Fallback: polling continues via the interval
      };

      state.streamClient = { transport: "sse", close: () => eventSource.close() };
    } catch {
      // EventSource not supported — polling continues
    }
  }

  // -----------------------------------------------------------------------
  // Selection helpers
  // -----------------------------------------------------------------------

  function selectedLauncherAgents() {
    return Array.from(
      elements.launcherAgents.querySelectorAll('input[data-role="real-agent"]:checked, input[data-role="debug-agent"]:checked')
    ).map((input) => input.value);
  }

  function selectedLauncherVariants() {
    const variants = [];

    // Check if global model override is enabled
    const globalModel = state.launcherGlobalModelEnabled && state.launcherGlobalModelOverride?.trim()
      ? state.launcherGlobalModelOverride.trim()
      : undefined;

    // Generic variants from VARIANT_CONFIGS
    for (const config of VARIANT_CONFIGS) {
      const stateKey = variantStateKey(config.id);
      for (const variant of state[stateKey].filter(v => v.enabled)) {
        const variantId = `${config.id}-${variant.id}`;
        const useGlobalModel = globalModel && state.launcherGlobalModelAgentIds.includes(variantId);
        const entry = {
          baseAgentId: config.baseAgentId,
          displayLabel: variant.displayLabel.trim() || config.labelKeyEn.replace(' Variants', ''),
          config: {
            model: useGlobalModel ? globalModel : (variant.model?.trim() || undefined),
          },
          configSource: "ui"
        };
        if (config.hasReasoning && variant.reasoningEffort) {
          entry.config.reasoningEffort = variant.reasoningEffort.trim() || undefined;
        }
        variants.push(entry);
      }
    }

    // Claude variants
    for (const variant of state.launcherClaudeVariants.filter((v) => v.enabled)) {
      const variantId = `claude-${variant.profileId}`;
      const useGlobalModel = globalModel && state.launcherGlobalModelAgentIds.includes(variantId);
      variants.push({
        baseAgentId: "claude-code",
        displayLabel: variant.displayLabel.trim() || `Claude Code · ${variant.providerName ?? "Official"}`,
        config: {
          model: useGlobalModel ? globalModel : (variant.model.trim() || undefined),
          providerProfileId: variant.profileId
        },
        configSource: "ui"
      });
    }

    // Other agents
    const otherAgents = selectedLauncherAgents().map((agentId) => {
      const variantId = `agent-${agentId}`;
      const useGlobalModel = globalModel && state.launcherGlobalModelAgentIds.includes(variantId);
      return {
        baseAgentId: agentId,
        displayLabel: state.availableAdapters.find((adapter) => adapter.id === agentId)?.title ?? agentId,
        config: useGlobalModel ? { model: globalModel } : {},
        configSource: "ui"
      };
    });

    return [...otherAgents, ...variants];
  }

  // -----------------------------------------------------------------------
  // DOM → State sync (generic)
  // -----------------------------------------------------------------------

  function syncLauncherStateFromDom() {
    syncProviderEditorStateFromDom();

    state.launcherSelectedAgentIds = selectedLauncherAgents();

    // Global model override
    const globalModelInput = document.getElementById("launcher-global-model");
    if (globalModelInput) {
      state.launcherGlobalModelOverride = globalModelInput.value;
    }

    // Codex variants (special: has source/verification)
    state.launcherCodexVariants = Array.from(
      elements.launcherAgents.querySelectorAll("[data-codex-variant-id]")
    ).map((element) => ({
      id: element.getAttribute("data-codex-variant-id"),
      enabled: element.querySelector('[data-role="variant-enabled"]')?.checked ?? false,
      displayLabel: element.querySelector('[data-role="variant-label"]')?.value ?? "Codex CLI",
      model: element.querySelector('[data-role="variant-model"]')?.value ?? "",
      reasoningEffort: element.querySelector('[data-role="variant-reasoning"]')?.value ?? "",
      source: state.serviceInfo?.codexDefaults?.source ?? "unknown",
      verification: state.serviceInfo?.codexDefaults?.verification ?? "unknown"
    }));

    // Claude variants
    state.launcherClaudeVariants = Array.from(
      elements.launcherAgents.querySelectorAll("[data-claude-variant-id]")
    ).map((element) => {
      const profileId = element.getAttribute("data-profile-id") || "claude-official";
      const profile = state.availableProviderProfiles.find((entry) => entry.id === profileId);
      return {
        id: element.getAttribute("data-claude-variant-id"),
        profileId,
        enabled: element.querySelector('[data-role="claude-variant-enabled"]')?.checked ?? false,
        displayLabel:
          element.querySelector('[data-role="claude-variant-label"]')?.value ??
          `Claude Code · ${profile?.name ?? "Official"}`,
        model: element.querySelector('[data-role="claude-variant-model"]')?.value ?? "",
        providerName: profile?.name ?? "Official",
        providerKind: profile?.kind ?? "official",
        secretStored: Boolean(profile?.secretStored),
        isBuiltIn: Boolean(profile?.isBuiltIn)
      };
    });

    // Generic variants (Gemini, Aider, Kilo, OpenCode)
    for (const config of VARIANT_CONFIGS) {
      if (config.id === 'codex') continue; // handled above
      const stateKey = variantStateKey(config.id);
      const rp = rolePrefix(config.id);
      state[stateKey] = Array.from(
        elements.launcherAgents.querySelectorAll(`[${variantDataAttr(config.id)}]`)
      ).map((element) => ({
        id: element.getAttribute(variantDataAttr(config.id)),
        enabled: element.querySelector(`[data-role="${rp}enabled"]`)?.checked ?? false,
        displayLabel: element.querySelector(`[data-role="${rp}label"]`)?.value ?? config.labelKeyEn.replace(' Variants', ''),
        model: element.querySelector(`[data-role="${rp}model"]`)?.value ?? ""
      }));
    }

    saveLauncherConfig();
  }

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  function validateLauncher() {
    const messages = [];
    const selectedTaskPack = state.availableTaskPacks.find((tp) => tp.path === elements.launcherTaskPath.value);
    const isBuiltinTaskPack = selectedTaskPack?.repoSource?.startsWith("builtin://");
    // Only require repo path if the task pack does NOT use a builtin repo
    if (!isBuiltinTaskPack && !elements.launcherRepoPath.value.trim()) {
      messages.push({ level: "error", text: localText("仓库路径不能为空。", "Repository path is required.") });
    }
    const hasAdhocPrompt = elements.launcherAdhocPrompt.value.trim().length > 0;
    if (!elements.launcherTaskPath.value.trim() && !hasAdhocPrompt) {
      messages.push({ level: "error", text: localText("请选择任务包或输入自定义提示词。", "Select a task pack or enter a custom prompt.") });
    }
    const agents = selectedLauncherVariants();
    if (agents.length === 0) {
      messages.push({ level: "error", text: localText("至少需要启用一个 agent 或 variant。", "At least one agent or variant must be enabled.") });
    }
    if (isBuiltinTaskPack && elements.launcherRepoPath.value.trim()) {
      messages.push({ level: "warning", text: localText("此任务包使用内置仓库，你填写的仓库路径将被忽略。", "This task pack uses a built-in repo. Your repository path will be ignored.") });
    }
    const noSecretVariants = state.launcherClaudeVariants.filter((v) => v.enabled && !v.secretStored && v.providerKind !== "official");
    for (const v of noSecretVariants) {
      messages.push({ level: "warning", text: localText(`Claude variant "${v.displayLabel}" 的密钥未保存，运行可能失败。`, `Claude variant "${v.displayLabel}" has no stored secret — the run may fail.`) });
    }
    return messages;
  }

  function renderLauncherValidation(messages) {
    if (!messages || messages.length === 0) {
      elements.launcherValidation.innerHTML = "";
      return;
    }
    elements.launcherValidation.innerHTML = messages
      .map((m) => `<div class="validation-msg validation-${escapeHtml(m.level)}">${escapeHtml(m.text)}</div>`)
      .join("");
  }

  // -----------------------------------------------------------------------
  // Run execution
  // -----------------------------------------------------------------------

  async function handleQuickStart() {
    if (state.runInProgress || !state.serviceInfo) return false;

    const repoPath = elements.launcherRepoPath.value.trim() || state.serviceInfo.repoPath || ".";
    const taskPath = state.serviceInfo.demoTaskPath || "";
    if (!taskPath) {
      state.notice = localText("没有找到默认任务包，请手动选择。", "No default task pack found. Please select manually.");
      render();
      return false;
    }

    let agents = selectedLauncherVariants();
    if (agents.length === 0) {
      agents = [
        { baseAgentId: "demo-fast", displayLabel: "Demo Fast", config: {}, configSource: "ui" },
        { baseAgentId: "demo-thorough", displayLabel: "Demo Thorough", config: {}, configSource: "ui" }
      ];
    }

    elements.launcherRepoPath.value = repoPath;
    elements.launcherTaskPath.value = taskPath;
    state.runInProgress = true;
    state.launcherExpanded = false;
    state.runStatus = { state: "running", phase: "starting", startedAt: new Date().toISOString(), logs: [] };
    state.notice = localText("快速体验已启动...", "Quick start running...");
    render();

    try {
      const response = await apiFetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, taskPath, agents, probeAuth: false, scoreMode: state.launcherScoreMode, entryPoint: "legacy-quick-demo" })
      });
      const result = await response.json();
      if (!response.ok && response.status !== 202) {
        throw new Error(result.error || "Unknown error");
      }
      startRunStatusPolling();
      render();
      return true;
    } catch (error) {
      stopRunStatusPolling();
      state.runStatus = null;
      state.runInProgress = false;
      state.notice = localText(`快速体验失败: ${error.message}`, `Quick start failed: ${error.message}`);
      render();
      return false;
    }
  }

  async function handleLauncherRun() {
    const messages = validateLauncher();
    renderLauncherValidation(messages);
    if (messages.some((m) => m.level === "error")) {
      // Expand the launcher and scroll to validation errors so the user sees them
      state.launcherExpanded = true;
      render();
      // Wait for DOM update, then scroll to validation messages
      requestAnimationFrame(() => {
        elements.launcherValidation?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      // Also show alert so the user definitely sees the error
      const errorText = messages.filter(m => m.level === "error").map(m => m.text).join("\n");
      alert(errorText);
      return;
    }

    const agents = selectedLauncherVariants();
    let taskPath = elements.launcherTaskPath.value.trim();

    const adhocPrompt = elements.launcherAdhocPrompt.value.trim();
    if (!taskPath && adhocPrompt) {
      elements.launcherRun.disabled = true;
      elements.launcherRun.textContent = localText("正在创建任务包...", "Creating task pack...");
      try {
        const adhocResponse = await apiFetch("/api/create-adhoc-taskpack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: adhocPrompt })
        });
        const adhocResult = await adhocResponse.json();
        if (!adhocResponse.ok) {
          throw new Error(adhocResult.error || localText("创建临时任务包失败", "Failed to create adhoc task pack"));
        }
        taskPath = adhocResult.path;
        elements.launcherTaskPath.value = taskPath;
      } catch (error) {
        elements.launcherRun.disabled = false;
        elements.launcherRun.textContent = t("launcherRunButton");
        state.notice = error instanceof Error ? error.message : String(error);
        render();
        return;
      }
    }

    const concurrencyValue = Number.parseInt(document.querySelector("#launcher-concurrency")?.value ?? "1", 10);
    const maxConcurrency = Number.isFinite(concurrencyValue) && concurrencyValue > 0 ? concurrencyValue : 1;

    // For builtin task packs, use "." as repoPath — the server will resolve
    // the builtin:// repoSource and ignore the user repo path entirely.
    const selectedTaskPackForRun = state.availableTaskPacks.find((tp) => tp.path === taskPath);
    const isBuiltin = selectedTaskPackForRun?.repoSource?.startsWith("builtin://");
    const repoPath = elements.launcherRepoPath.value.trim() || (isBuiltin ? "." : ".");

    const payload = {
      repoPath,
      taskPath,
      outputPath: elements.launcherOutputPath.value.trim() || undefined,
      agents,
      probeAuth: elements.launcherProbeAuth.checked,
      maxConcurrency,
      scoreMode: state.launcherScoreMode,
      entryPoint: "legacy-launcher"
    };

    elements.launcherValidation.innerHTML = "";
    elements.launcherRun.disabled = true;
    elements.launcherRun.textContent = localText("正在启动...", "Starting...");
    elements.launcherStatus.textContent = localText("正在提交跑分请求...", "Submitting benchmark request...");
    elements.launcherStatus.classList.add("running");

    state.runInProgress = true;
    state.launcherExpanded = false;
    state.runStatus = {
      state: "running",
      phase: "starting",
      startedAt: new Date().toISOString(),
      logs: []
    };
    state.notice = t("launcherStatusRunning");
    render();
    // Scroll to the progress section (below), not the launcher panel (above)
    elements.launcherProgress?.scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      const response = await apiFetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok && response.status !== 202) {
        throw new Error(result.error || localText("未知错误", "Unknown error"));
      }
      startRunStatusPolling();
      render();
    } catch (error) {
      stopRunStatusPolling();
      state.runStatus = null;
      state.runInProgress = false;
      state.notice = t("launcherStatusError", error instanceof Error ? error.message : String(error));
      elements.launcherStatus.classList.remove("running");
      render();
    }
  }

  // -----------------------------------------------------------------------
  // Provider profile CRUD
  // -----------------------------------------------------------------------

  async function saveProviderProfileFromEditor() {
    const editor = elements.launcherAgents.querySelector("[data-provider-editor='true']");
    if (!editor) return;

    const readValue = (selector) => editor.querySelector(selector)?.value?.trim() ?? "";
    const readChecked = (selector) => editor.querySelector(selector)?.checked ?? false;
    let extraEnv = {};
    const extraEnvRaw = editor.querySelector('[data-role="provider-extra-env"]')?.value?.trim() ?? "{}";
    try {
      extraEnv = extraEnvRaw ? JSON.parse(extraEnvRaw) : {};
    } catch {
      throw new Error(localText("额外环境变量 JSON 无法解析。", "Extra env JSON is invalid."));
    }

    const payload = {
      name: readValue('[data-role="provider-name"]'),
      kind: readValue('[data-role="provider-kind"]'),
      homepage: readValue('[data-role="provider-homepage"]') || undefined,
      baseUrl: readValue('[data-role="provider-base-url"]') || undefined,
      apiFormat: readValue('[data-role="provider-api-format"]'),
      primaryModel: readValue('[data-role="provider-primary-model"]') || undefined,
      thinkingModel: readValue('[data-role="provider-thinking-model"]') || undefined,
      defaultHaikuModel: readValue('[data-role="provider-haiku-model"]') || undefined,
      defaultSonnetModel: readValue('[data-role="provider-sonnet-model"]') || undefined,
      defaultOpusModel: readValue('[data-role="provider-opus-model"]') || undefined,
      notes: readValue('[data-role="provider-notes"]') || undefined,
      extraEnv,
      writeCommonConfig: readChecked('[data-role="provider-write-common-config"]')
    };
    const secret = editor.querySelector('[data-role="provider-secret"]')?.value ?? "";
    const isEdit = Boolean(state.launcherProviderEditor?.id);

    if (!payload.name) {
      throw new Error(localText("Provider 名称不能为空。", "Provider name is required."));
    }
    if (!payload.baseUrl) {
      throw new Error(localText("Base URL 不能为空。", "Base URL is required."));
    }
    if (!payload.primaryModel) {
      throw new Error(localText("主模型不能为空，至少填写一个模型名称。", "Primary Model is required — at least one model name is needed."));
    }
    if (!isEdit && !secret.trim()) {
      throw new Error(localText("新建 Provider 时 API Key 不能为空。", "API Key is required when creating a new provider."));
    }

    const url = isEdit
      ? `/api/provider-profiles/${encodeURIComponent(state.launcherProviderEditor.id)}`
      : "/api/provider-profiles";
    const method = isEdit ? "PUT" : "POST";
    const response = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isEdit ? payload : { ...payload, secret: secret || undefined })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || localText("保存 Provider 配置失败。", "Failed to save provider profile."));
    }

    if (isEdit && secret.trim()) {
      const secretResponse = await apiFetch(`/api/provider-profiles/${encodeURIComponent(state.launcherProviderEditor.id)}/secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret })
      });
      const secretResult = await secretResponse.json();
      if (!secretResponse.ok) {
        throw new Error(secretResult.error || localText("保存 Provider 密钥失败。", "Failed to store provider secret."));
      }
      state.availableProviderProfiles = secretResult.profiles ?? state.availableProviderProfiles;
    } else {
      state.availableProviderProfiles = result.profiles ?? state.availableProviderProfiles;
    }

    // Sync DOM state before rebuilding variants to preserve user edits
    syncLauncherStateFromDom();
    syncClaudeVariantsWithProfiles();
    state.launcherProviderEditor = null;
  }

  async function deleteProviderProfileById(profileId) {
    const response = await apiFetch(`/api/provider-profiles/${encodeURIComponent(profileId)}`, {
      method: "DELETE"
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || localText("删除 Provider 配置失败。", "Failed to delete provider profile."));
    }
    state.availableProviderProfiles = result.profiles ?? [];
    syncLauncherStateFromDom();
    syncClaudeVariantsWithProfiles();
  }

  // -----------------------------------------------------------------------
  // Extract agent config from card (for test connection)
  // -----------------------------------------------------------------------

  function extractAgentConfigFromCard(buttonEl) {
    const card = buttonEl.closest(".variant-card");
    const role = buttonEl.getAttribute("data-role");

    if (role === "real-agent-test") {
      const agentId = buttonEl.getAttribute("data-agent-id");
      return { baseAgentId: agentId, displayLabel: agentId, config: {} };
    }

    if (!card) return null;

    // Claude variant
    if (card.hasAttribute("data-claude-variant-id")) {
      return {
        baseAgentId: "claude-code",
        displayLabel: card.querySelector('[data-role="claude-variant-label"]')?.value?.trim() || "Claude Code",
        config: {
          model: card.querySelector('[data-role="claude-variant-model"]')?.value?.trim() || undefined,
          providerProfileId: card.getAttribute("data-profile-id") || undefined,
        },
      };
    }

    // Generic variant — check which config it belongs to
    for (const config of VARIANT_CONFIGS) {
      if (card.hasAttribute(variantDataAttr(config.id))) {
        const rp = rolePrefix(config.id);
        const entry = {
          baseAgentId: config.baseAgentId,
          displayLabel: card.querySelector(`[data-role="${rp}label"]`)?.value?.trim() || config.labelKeyEn.replace(' Variants', ''),
          config: {
            model: card.querySelector(`[data-role="${rp}model"]`)?.value?.trim() || undefined,
          },
        };
        if (config.hasReasoning) {
          entry.config.reasoningEffort = card.querySelector(`[data-role="${rp}reasoning"]`)?.value?.trim() || undefined;
        }
        return entry;
      }
    }

    return null;
  }

  function showPreflightToast(buttonEl, status, summary) {
    const existingToast = buttonEl.parentElement?.querySelector(".preflight-toast");
    if (existingToast) existingToast.remove();

    const toast = document.createElement("span");
    toast.className = `preflight-toast ${status}`;
    const icon = status === "ready" ? "✓" : status === "unverified" ? "?" : "✗";
    const labelKey = `testConnection${status.charAt(0).toUpperCase() + status.slice(1)}`;

    // 显示状态和具体原因
    const statusText = t(labelKey);
    if (summary && status !== "ready") {
      // 截断过长的 summary，保留关键信息
      const shortSummary = summary.length > 80 ? summary.substring(0, 80) + "..." : summary;
      toast.textContent = `${icon} ${statusText}: ${shortSummary}`;
      toast.title = summary; // 完整信息在 hover 时显示
    } else {
      toast.textContent = `${icon} ${statusText}`;
      if (summary) toast.title = summary;
    }

    buttonEl.parentElement?.appendChild(toast);
    // 错误信息显示更久
    const duration = status === "ready" ? 3000 : 8000;
    setTimeout(() => toast.remove(), duration);
  }

  async function handleTestConnection(buttonEl) {
    const agentConfig = extractAgentConfigFromCard(buttonEl);
    if (!agentConfig) return;

    const originalText = buttonEl.textContent;
    buttonEl.innerHTML = `<span class="spinner"></span> ${escapeHtml(t("testConnectionTesting"))}`;
    buttonEl.disabled = true;
    buttonEl.classList.add("testing");

    try {
      const response = await apiFetch("/api/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agentConfig),
      });
      if (handleApiError(response)) return;
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        showPreflightToast(buttonEl, "error", err.error || `HTTP ${response.status}`);
        return;
      }
      const result = await response.json();
      showPreflightToast(buttonEl, result.status, result.summary);
    } catch (error) {
      showPreflightToast(buttonEl, "error", error?.message || "Network error");
    } finally {
      buttonEl.textContent = originalText;
      buttonEl.disabled = false;
      buttonEl.classList.remove("testing");
    }
  }

  // -----------------------------------------------------------------------
  // Quick preflight — fast CLI + auth check (2s instead of 60s)
  // -----------------------------------------------------------------------

  async function runQuickPreflight(agentId, agentConfig) {
    try {
      const response = await apiFetch("/api/quick-preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseAgentId: agentId, ...agentConfig }),
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  function updateAgentCardPreflightStatus(cardEl, result) {
    let indicator = cardEl.querySelector(".preflight-indicator");
    if (!indicator) {
      indicator = document.createElement("span");
      indicator.className = "preflight-indicator";
      cardEl.querySelector(".agent-card-header")?.appendChild(indicator);
    }
    if (!result) {
      indicator.className = "preflight-indicator unknown";
      indicator.textContent = "";
      indicator.title = "";
      return;
    }
    const { overallStatus, cliExists, cliVersion, authConfigured, authHint } = result;
    indicator.className = `preflight-indicator ${overallStatus}`;
    if (overallStatus === "ready") {
      indicator.textContent = "✓";
      indicator.title = `CLI ${cliVersion || "found"} · Auth configured`;
    } else if (overallStatus === "warning") {
      indicator.textContent = "⚠";
      indicator.title = authHint || "Auth may not be configured";
    } else {
      indicator.textContent = "✗";
      indicator.title = cliExists ? (authHint || "Auth not configured") : "CLI not found";
    }
  }

  // -----------------------------------------------------------------------
  // Task pack compatibility refresh — re-fetch when repo path changes
  // -----------------------------------------------------------------------

  let _refreshTaskPacksTimer = null;

  async function refreshTaskPackCompatibility() {
    const repoPath = elements.launcherRepoPath?.value?.trim() ?? "";
    const url = repoPath ? `/api/taskpacks?repoPath=${encodeURIComponent(repoPath)}` : "/api/taskpacks";
    try {
      const response = await apiFetch(url);
      if (response.ok) {
        state.availableTaskPacks = await response.json();
        renderLauncher();
      }
    } catch {
      // Silently ignore — keep existing task pack list
    }
  }

  function debouncedRefreshTaskPacks() {
    if (_refreshTaskPacksTimer) clearTimeout(_refreshTaskPacksTimer);
    _refreshTaskPacksTimer = setTimeout(() => {
      refreshTaskPackCompatibility();
    }, 800);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  return {
    defaultCodexVariant,
    defaultGeminiVariant: () => defaultVariant(VARIANT_CONFIGS.find(c => c.id === 'gemini')),
    defaultAiderVariant: () => defaultVariant(VARIANT_CONFIGS.find(c => c.id === 'aider')),
    defaultKiloVariant: () => defaultVariant(VARIANT_CONFIGS.find(c => c.id === 'kilo')),
    defaultOpencodeVariant: () => defaultVariant(VARIANT_CONFIGS.find(c => c.id === 'opencode')),
    syncClaudeVariantsWithProfiles,
    syncLauncherVariantsWithAdapters,
    summarizeLauncherSelection,
    renderTaskPackDetail,
    saveLauncherConfig,
    renderLauncher,
    detectService,
    pollRunStatus,
    stopRunStatusPolling,
    startRunStatusPolling,
    selectedLauncherAgents,
    selectedLauncherVariants,
    syncLauncherStateFromDom,
    validateLauncher,
    renderLauncherValidation,
    handleQuickStart,
    handleLauncherRun,
    openProviderEditor,
    saveProviderProfileFromEditor,
    deleteProviderProfileById,
    runQuickPreflight,
    updateAgentCardPreflightStatus,
    debouncedRefreshTaskPacks,
    refreshTaskPackCompatibility
  };
}
