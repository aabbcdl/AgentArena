import { escapeHtml } from "./app-helpers.js";
import {
  DEFAULT_SCORE_WEIGHTS,
  getMatchingScorePresetId,
  getScoreWeightPreset,
  normalizeScoreWeights
} from "./view-model.js";

const WEIGHT_NAMES = {
  status: 'scoreWeightStatus',
  tests: 'scoreWeightTests',
  criticalJudges: 'scoreWeightCriticalJudges',
  nonCriticalJudges: 'scoreWeightNonCriticalJudges',
  resolutionRate: 'scoreWeightResolutionRate',
  tokenEfficiency: 'scoreWeightTokenEfficiency',
  acceptanceRate: 'scoreWeightAcceptanceRate',
  categoryScore: 'scoreWeightCategoryScore',
  duration: 'scoreWeightDuration',
  cost: 'scoreWeightCost',
  precision: 'scoreWeightPrecision',
  lint: 'scoreWeightLint'
};

const scoreWeightElements = {
  status: "scoreWeightStatus",
  tests: "scoreWeightTests",
  criticalJudges: "scoreWeightCriticalJudges",
  nonCriticalJudges: "scoreWeightNonCriticalJudges",
  resolutionRate: "scoreWeightResolutionRate",
  tokenEfficiency: "scoreWeightTokenEfficiency",
  acceptanceRate: "scoreWeightAcceptanceRate",
  categoryScore: "scoreWeightCategoryScore",
  duration: "scoreWeightDuration",
  cost: "scoreWeightCost"
};

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export function getNormalizedScoreWeights(state) {
  return normalizeScoreWeights(state.scoreWeights);
}

export function saveScoreConfig(state) {
  writeStorage(
    "agentarena.webReport.scoreConfig",
    JSON.stringify({ scoreWeights: state.scoreWeights })
  );
}

export function loadScoreConfig() {
  try {
    const raw = readStorage("agentarena.webReport.scoreConfig");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getScoreModeLabel(state, t) {
  const presetId = getMatchingScorePresetId(state.scoreWeights);
  const map = {
    balanced: "scorePresetBalanced",
    "correctness-first": "scorePresetCorrectness",
    "speed-first": "scorePresetSpeed",
    "cost-first": "scorePresetCost",
    "scope-discipline": "scorePresetScope",
    "issue-resolution": "scorePresetIssueResolution",
    "efficiency-first": "scorePresetEfficiencyFirst",
    "rotating-tasks": "scorePresetRotatingTasks",
    comprehensive: "scorePresetComprehensive"
  };
  return map[presetId] ? t(map[presetId]) : t("customWeights");
}

export function getArchivedScoreModeLabel(run, t) {
  const mode = run?.scoreMode ?? "balanced";
  const map = {
    balanced: "scorePresetBalanced",
    "correctness-first": "scorePresetCorrectness",
    "speed-first": "scorePresetSpeed",
    "cost-first": "scorePresetCost",
    "scope-discipline": "scorePresetScope",
    "issue-resolution": "scorePresetIssueResolution",
    "efficiency-first": "scorePresetEfficiencyFirst",
    "rotating-tasks": "scorePresetRotatingTasks",
    comprehensive: "scorePresetComprehensive"
  };
  return map[mode] ? t(map[mode]) : mode;
}

export function applyScorePreset(state, presetId, renderDeps) {
  state.scoreWeights = { ...getScoreWeightPreset(presetId) };
  saveScoreConfig(state);
  renderDeps.renderScoreWeightsControls();
  renderDeps.renderWeightSliders(state.scoreWeights);
  if (state.run) {
    renderDeps.renderAll();
  }
}

export function updateScoreWeight(state, key, value, renderDeps) {
  const newValue = Number.isFinite(value) && value >= 0 ? value : 0;
  state.scoreWeights = { ...state.scoreWeights, [key]: newValue };
  saveScoreConfig(state);
  renderDeps.renderScoreWeightsControls();
  if (state.run) {
    renderDeps.renderAll();
  }
}

export function renderScoreWeightsControls(state, elements, t) {
  const normalized = getNormalizedScoreWeights(state);
  for (const [key, elementName] of Object.entries(scoreWeightElements)) {
    if (elements[elementName]) {
      elements[elementName].value = String(state.scoreWeights[key]);
    }
  }
  if (elements.scoreWeightsSummary) {
    elements.scoreWeightsSummary.textContent = t("scoreWeightsSummary", normalized);
  }
  if (elements.scoreWeightPresets) {
    const activePreset = getMatchingScorePresetId(state.scoreWeights);
    for (const button of elements.scoreWeightPresets.querySelectorAll("button[data-score-preset]")) {
      button.classList.toggle("active", button.dataset.scorePreset === activePreset);
    }
  }
  renderWeightSliders(state.scoreWeights, t);
}

export function renderWeightSliders(weights, t) {
  const container = document.getElementById('weight-sliders');
  if (!container) return;
  container.innerHTML = '';
  for (const [key, value] of Object.entries(weights)) {
    if (value === 0) continue;
    const slider = document.createElement('div');
    slider.className = 'weight-slider';
    const label = document.createElement('label');
    const i18nKey = WEIGHT_NAMES[key] || key;
    const displayName = t ? t(i18nKey) : i18nKey;
    const percentage = (value * 100).toFixed(0);
    label.innerHTML = `${escapeHtml(displayName)} <span class="weight-value">${percentage}%</span>`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.value = percentage;
    input.dataset.weight = key;
    input.addEventListener('input', (e) => {
      const newWeight = parseInt(e.target.value, 10) / 100;
      label.querySelector('.weight-value').textContent = `${(newWeight * 100).toFixed(0)}%`;
    });
    slider.appendChild(label);
    slider.appendChild(input);
    container.appendChild(slider);
  }
}

export { DEFAULT_SCORE_WEIGHTS, scoreWeightElements, WEIGHT_NAMES };
