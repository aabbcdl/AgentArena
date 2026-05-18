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
      enabled: true,
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
    const model = defaults.effectiveModel ?? '';
    const reasoning = defaults.effectiveReasoningEffort ?? '';
    const labelParts = ['Codex CLI'];
    if (model) labelParts.push(model);
    if (reasoning) labelParts.push(reasoning);
    return {
      id: clientRandomId(),
      enabled: true,
      displayLabel: labelParts.join(' · '),
      model,
      reasoningEffort: reasoning,
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
          <input data-role="${rp}model" type="text" value="${escapeHtml(variant.model ?? '')}" placeholder="${escapeHtml(config.defaultModelPlaceholder)}" />
        </label>`);
    }

    // Reasoning effort field (Codex only)
    if (config.fields.includes('reasoningEffort') && config.hasReasoning) {
      fields.push(`
        <label class="field">
          <span>${escapeHtml(localText("推理等级", "Reasoning Effort"))}</span>
          <input data-role="${rp}reasoning" list="reasoning-levels" type="text" value="${escapeHtml(variant.reasoningEffort ?? '')}" placeholder="low / medium / high" />
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
          <p class="muted">${escapeHtml(localText("密钥状态", "Secret"))}: ${escapeHtml(
            profile?.kind === "official"
              ? localText("官方登录态", "Official login")
              : profile?.secretStored
                ? localText("已存储", "Stored")
                : localText("未保存，运行会被阻止", "Missing; runs will be blocked")
          )}</p>
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
              <option value="anthropic-compatible" ${editor.kind === "anthropic-compatible" ? "selected" : ""}>Anthropic Compatible</option>
              <option value="openai-proxy" ${editor.kind === "openai-proxy" ? "selected" : ""}>OpenAI Proxy</option>
            </select>
          </label>
          <label class="field">
            <span>${escapeHtml(localText("官网链接", "Homepage"))} <span class="field-optional">${escapeHtml(localText("选填", "optional"))}</span></span>
            <input data-role="provider-homepage" type="text" value="${escapeHtml(editor.homepage)}" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("Base URL", "Base URL"))} <span class="field-optional">${escapeHtml(localText("选填", "optional"))}</span></span>
            <input data-role="provider-base-url" type="text" value="${escapeHtml(editor.baseUrl)}" />
          </label>
          <label class="field">
            <span>${escapeHtml(localText("API 格式", "API Format"))} <span class="field-required">${escapeHtml(localText("必填", "required"))}</span></span>
            <select data-role="provider-api-format">
              <option value="anthropic-messages" ${editor.apiFormat === "anthropic-messages" ? "selected" : ""}>Anthropic Messages</option>
              <option value="openai-chat-via-proxy" ${editor.apiFormat === "openai-chat-via-proxy" ? "selected" : ""}>OpenAI Chat via Proxy</option>
            </select>
          </label>
          <label class="field">
            <span>${escapeHtml(localText("主模型", "Primary Model"))} <span class="field-optional">${escapeHtml(localText("选填", "optional"))}</span></span>
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
            <input data-role="provider-secret" type="password" value="" placeholder="${escapeHtml(localText("留空则不修改当前已保存的 secret", "Leave blank to keep the currently stored secret"))}" />
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

    elements.launcherProgressTitle.innerHTML = `${escapeHtml(t("launcherProgressTitle"))}${state.runInProgress ? buildStepIndicatorHtml() : ""}`;
    const currentAgent = state.runStatus?.currentDisplayLabel || state.runStatus?.currentVariantId || state.runStatus?.currentAgentId;
    elements.launcherCurrentAgent.textContent = currentAgent
      ? t("launcherCurrentAgentLabel", currentAgent)
      : t("launcherCurrentAgentIdle");

    const logs = Array.isArray(state.runStatus?.logs) ? state.runStatus.logs : [];
    if (logs.length === 0) {
      const startingText = localText("正在启动...", "Starting...");
      elements.launcherLogList.innerHTML = `<div class="muted"><span class="status-badge status-starting">${escapeHtml(startingText)}</span></div>`;
      return;
    }

    elements.launcherLogList.innerHTML = logs
      .slice()
      .reverse()
      .map((entry) => {
        const phase = t(`launcherPhases.${entry.phase ?? "starting"}`);
        const actor = entry.displayLabel ? `${escapeHtml(entry.displayLabel)} · ` : "";
        return `
          <article class="launcher-log-entry">
            <div class="launcher-log-head">
              <span class="status-badge status-${escapeHtml(entry.phase ?? "starting")}">${escapeHtml(phase)}</span>
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
    `;
    setHidden(elements.taskPackDetail, false);
  }

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------

  function renderLauncher() {
    setHidden(elements.launcherPanel, false);
    const info = state.serviceInfo || {};

    // Restore saved config once on first render
    if (!state._launcherConfigRestored) {
      state._launcherConfigRestored = true;
      const saved = loadLauncherConfig();
      if (saved) {
        elements.launcherRepoPath.value = saved.repoPath || info.repoPath || "";
        elements.launcherOutputPath.value = saved.outputPath || info.defaultOutputPath || "";
        elements.launcherTaskPath.value = saved.taskPath || "";
        elements.launcherProbeAuth.checked = Boolean(saved.probeAuth);
        state.launcherSelectedAgentIds = saved.selectedAgentIds ?? [];
        state.launcherScoreMode = saved.scoreMode || "practical";

        // Restore generic variants
        for (const config of VARIANT_CONFIGS) {
          const savedKey = `${config.id}Variants`;
          const stateKey = variantStateKey(config.id);
          if (saved[savedKey]?.length) {
            state[stateKey] = saved[savedKey].map((sv) => ({
              ...(config.id === 'codex' ? defaultCodexVariant() : defaultVariant(config)),
              enabled: sv.enabled ?? true,
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
    const grouped = { easy: [], medium: [], hard: [], other: [] };
    for (const tp of state.availableTaskPacks) {
      const key = tp.difficulty && grouped[tp.difficulty] ? tp.difficulty : "other";
      grouped[key].push(tp);
    }
    for (const arr of Object.values(grouped)) {
      arr.sort((a, b) => (taskPackI18n(a, "title") || a.title).localeCompare(taskPackI18n(b, "title") || b.title));
    }

    const customOption = `<option value="">${escapeHtml(t("taskPackCustom"))}</option>`;
    const groupLabels = { easy: t("difficultyEasy") || "简单", medium: t("difficultyMedium") || "中等", hard: t("difficultyHard") || "困难", other: t("difficultyOther") || "其他" };
    const optionHtml = [customOption];
    for (const diffKey of ["easy", "medium", "hard", "other"]) {
      const packs = grouped[diffKey];
      if (packs.length === 0) continue;
      optionHtml.push(`<optgroup label="${escapeHtml(groupLabels[diffKey])} (${packs.length})">`);
      for (const tp of packs) {
        const tpTitle = taskPackI18n(tp, "title") || tp.title;
        optionHtml.push(`<option value="${escapeHtml(tp.path)}">${escapeHtml(tpTitle)}</option>`);
      }
      optionHtml.push(`</optgroup>`);
    }

    if (elements.launcherTaskSelect) {
      elements.launcherTaskSelect.innerHTML = optionHtml.join("");
    }

    if (!elements.launcherTaskPath.value && info.defaultTaskPath) {
      elements.launcherTaskPath.value = info.defaultTaskPath;
      elements.launcherTaskSelect.value = info.defaultTaskPath;
    } else if (elements.launcherTaskPath.value) {
      const matching = state.availableTaskPacks.find((taskPack) => taskPack.path === elements.launcherTaskPath.value);
      elements.launcherTaskSelect.value = matching ? matching.path : "";
    }

    const selectedTaskPackPath = elements.launcherTaskSelect.value || elements.launcherTaskPath.value;
    const selectedTaskPack = state.availableTaskPacks.find((taskPack) => taskPack.path === selectedTaskPackPath) ?? null;
    renderTaskPackDetail(selectedTaskPack);

    // Real adapters (non-demo, non-variant-managed)
    const variantAgentIds = new Set(VARIANT_CONFIGS.map(c => c.baseAgentId));
    variantAgentIds.add('claude-code');
    const realAdapters = state.availableAdapters.filter(
      (adapter) => adapter.kind !== "demo" && !variantAgentIds.has(adapter.id)
    );
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

    elements.launcherAgents.innerHTML = `
      ${taskSummary}
      <div class="launcher-section">
        <h4>${escapeHtml(localText("选择参赛 Agent", "Select Agents"))}</h4>
        <p class="muted">${escapeHtml(localText("勾选要参与对比的 Agent。", "Check the agents you want to compare."))}</p>
        <div class="checkbox-grid">
          ${realAdapters
            .map((adapter) => {
              const checked = state.launcherSelectedAgentIds.includes(adapter.id) ? "checked" : "";
              return `
                <div class="checkbox-with-test">
                  <label class="checkbox">
                    <input type="checkbox" data-role="real-agent" value="${escapeHtml(adapter.id)}" ${checked} />
                    <span>${escapeHtml(adapter.title)}</span>
                  </label>
                  <button type="button" class="btn-test-connection" data-role="real-agent-test" data-agent-id="${escapeHtml(adapter.id)}">${escapeHtml(t("testConnection"))}</button>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
      <details class="launcher-section">
        <summary class="launcher-section-summary">${escapeHtml(localText("Claude Code 变体", "Claude Code Variants"))} · <span class="muted">${escapeHtml(localText(`${claudeEnabledCount} 个已启用`, `${claudeEnabledCount} enabled`))}</span></summary>
        <div class="launcher-info-box" style="margin-bottom:12px;padding:12px;border-radius:8px;background:var(--surface-secondary);border-left:3px solid var(--accent);">
          <p style="margin:0 0 8px;font-size:var(--text-sm);"><strong>${escapeHtml(localText("💡 关于 Claude Provider", "About Claude Provider"))}</strong></p>
          <ul style="margin:0;padding-left:20px;font-size:var(--text-xs);color:var(--text-secondary);line-height:1.6;">
            <li>${escapeHtml(localText(
              '<strong>"Official"（官方）</strong>：使用 Claude Code 官方登录态。需要先在终端运行 <code>claude login</code> 登录，之后 Benchmark 会自动复用登录状态。<strong>不需要填 API Key。</strong>',
              '<strong>"Official"</strong>: Uses your official Claude Code login. Run <code>claude login</code> in terminal first, then benchmark reuses it automatically. <strong>No API Key needed.</strong>'
            ))}</li>
            <li>${escapeHtml(localText(
              '<strong>第三方 Provider</strong>：如果你修改了 Claude Code 的配置文件（如 <code>.claude/settings.json</code> 指向第三方代理），或者想直接用 API Key 绕过登录，请点下方「新增 Claude Provider」添加第三方供应商。',
              '<strong>Third-party Provider</strong>: If you modified Claude Code config (e.g. <code>.claude/settings.json</code> pointing to a proxy), or want to use an API Key directly, click "Add Claude Provider" below.'
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

    elements.launcherRun.disabled = state.runInProgress;
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
      : state.notice ?? t("launcherStatusIdle");
    renderLauncherProgress();
  }

  // -----------------------------------------------------------------------
  // Service detection & polling
  // -----------------------------------------------------------------------

  async function detectService() {
    try {
      const [infoResponse, adaptersResponse, taskPacksResponse, runStatusResponse, providerProfilesResponse] = await Promise.all([
        apiFetch("/api/ui-info"),
        apiFetch("/api/adapters"),
        apiFetch("/api/taskpacks"),
        apiFetch("/api/run-status", { cache: "no-store" }),
        apiFetch("/api/provider-profiles")
      ]);
      if (!infoResponse.ok || !adaptersResponse.ok || !taskPacksResponse.ok || !runStatusResponse.ok || !providerProfilesResponse.ok) {
        return;
      }

      state.serviceInfo = await infoResponse.json();
      state.availableAdapters = await adaptersResponse.json();
      state.availableTaskPacks = await taskPacksResponse.json();
      state.runStatus = await runStatusResponse.json();
      state.availableProviderProfiles = await providerProfilesResponse.json();
      syncClaudeVariantsWithProfiles();
      state.runInProgress = state.runStatus?.state === "running";
      if (state.runInProgress) {
        startRunStatusPolling();
      } else {
        stopRunStatusPolling();
      }
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

    render();
  }

  async function pollRunStatus() {
    if (!state.serviceInfo) return;
    const requestSeq = ++state.runStatusRequestSeq;

    try {
      const response = await apiFetch("/api/run-status", { cache: "no-store" });
      if (!response.ok) return;
      const runStatus = await response.json();
      if (requestSeq !== state.runStatusRequestSeq) return;

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
        const errorMessage = state.runStatus.error || localText("未知错误", "Unknown error");
        state.runStatus = null;
        state.runInProgress = false;
        state.notice = t("launcherStatusError", errorMessage);
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
    state.runStatusPollTimer = window.setInterval(() => {
      void pollRunStatus();
    }, 1000);
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

    // Generic variants from VARIANT_CONFIGS
    for (const config of VARIANT_CONFIGS) {
      const stateKey = variantStateKey(config.id);
      for (const variant of state[stateKey].filter(v => v.enabled)) {
        const entry = {
          baseAgentId: config.baseAgentId,
          displayLabel: variant.displayLabel.trim() || config.labelKeyEn.replace(' Variants', ''),
          config: {
            model: variant.model?.trim() || undefined,
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
      variants.push({
        baseAgentId: "claude-code",
        displayLabel: variant.displayLabel.trim() || `Claude Code · ${variant.providerName ?? "Official"}`,
        config: {
          model: variant.model.trim() || undefined,
          providerProfileId: variant.profileId
        },
        configSource: "ui"
      });
    }

    // Other agents
    const otherAgents = selectedLauncherAgents().map((agentId) => ({
      baseAgentId: agentId,
      displayLabel: state.availableAdapters.find((adapter) => adapter.id === agentId)?.title ?? agentId,
      config: {},
      configSource: "ui"
    }));

    return [...otherAgents, ...variants];
  }

  // -----------------------------------------------------------------------
  // DOM → State sync (generic)
  // -----------------------------------------------------------------------

  function syncLauncherStateFromDom() {
    state.launcherSelectedAgentIds = selectedLauncherAgents();

    // Codex variants (special: has source/verification)
    state.launcherCodexVariants = Array.from(
      elements.launcherAgents.querySelectorAll("[data-codex-variant-id]")
    ).map((element) => ({
      id: element.getAttribute("data-codex-variant-id"),
      enabled: element.querySelector('[data-role="variant-enabled"]')?.checked ?? true,
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
        enabled: element.querySelector(`[data-role="${rp}enabled"]`)?.checked ?? true,
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
    if (!elements.launcherRepoPath.value.trim()) {
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
    const selectedTaskPack = state.availableTaskPacks.find((tp) => tp.path === elements.launcherTaskPath.value);
    if (selectedTaskPack?.repoSource?.startsWith("builtin://")) {
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
    if (state.runInProgress || !state.serviceInfo) return;

    const repoPath = elements.launcherRepoPath.value.trim() || state.serviceInfo.repoPath || ".";
    const taskPath = elements.launcherTaskPath.value.trim() || state.serviceInfo.defaultTaskPath || "";
    if (!taskPath) {
      state.notice = localText("没有找到默认任务包，请手动选择。", "No default task pack found. Please select manually.");
      render();
      return;
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
        body: JSON.stringify({ repoPath, taskPath, agents, probeAuth: false, scoreMode: state.launcherScoreMode })
      });
      const result = await response.json();
      if (!response.ok && response.status !== 202) {
        throw new Error(result.error || "Unknown error");
      }
      startRunStatusPolling();
      render();
    } catch (error) {
      stopRunStatusPolling();
      state.runStatus = null;
      state.runInProgress = false;
      state.notice = localText(`快速体验失败: ${error.message}`, `Quick start failed: ${error.message}`);
      render();
    }
  }

  async function handleLauncherRun() {
    const messages = validateLauncher();
    renderLauncherValidation(messages);
    if (messages.some((m) => m.level === "error")) {
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

    const payload = {
      repoPath: elements.launcherRepoPath.value.trim(),
      taskPath,
      outputPath: elements.launcherOutputPath.value.trim() || undefined,
      agents,
      probeAuth: elements.launcherProbeAuth.checked,
      maxConcurrency,
      scoreMode: state.launcherScoreMode
    };

    elements.launcherValidation.innerHTML = "";
    elements.launcherRun.disabled = true;
    elements.launcherRun.textContent = localText("正在启动...", "Starting...");
    elements.launcherStatus.textContent = localText("正在提交跑分请求...", "Submitting benchmark request...");
    elements.launcherStatus.style.color = "var(--accent)";

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
    elements.launcherPanel.scrollIntoView({ behavior: "smooth", block: "start" });

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
      elements.launcherStatus.style.color = "";
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

    if (!payload.name) {
      throw new Error(localText("Provider 名称不能为空。", "Provider name is required."));
    }

    const isEdit = Boolean(state.launcherProviderEditor?.id);
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
    toast.textContent = `${icon} ${t(labelKey)}`;
    if (summary) toast.title = summary;
    buttonEl.parentElement?.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
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
    deleteProviderProfileById
  };
}
