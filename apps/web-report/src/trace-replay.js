/**
 * Trace Replay UI Module
 * Provides visual replay interface for trace events.
 */
export function createTraceReplayModule({ escapeHtml, t }) {
  let currentTimeline = null;
  let currentStepIndex = 0;
  let playInterval = null;

  function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = ((ms % 60000) / 1000).toFixed(0);
    return `${mins}m ${secs}s`;
  }

  function renderTimeline() {
    if (!currentTimeline) return;

    const markersContainer = document.querySelector('.timeline-markers');
    const progressBar = document.querySelector('.timeline-progress');
    if (!markersContainer || !progressBar) return;

    markersContainer.innerHTML = '';
    const totalSteps = currentTimeline.steps.length;

    currentTimeline.steps.forEach((step, index) => {
      const position = totalSteps > 1 ? (index / (totalSteps - 1)) * 100 : 0;
      const marker = document.createElement('div');
      marker.className = `timeline-marker${step.category === 'error' ? ' error' : ''}`;
      marker.style.left = `${position}%`;
      marker.title = `${step.type}: ${step.summary}`;
      marker.addEventListener('click', () => goToStep(index));
      markersContainer.appendChild(marker);
    });

    const progress = totalSteps > 1 ? (currentStepIndex / (totalSteps - 1)) * 100 : 0;
    progressBar.style.width = `${progress}%`;
  }

  function renderStep(step) {
    const contentEl = document.getElementById('trace-replay-content');
    if (!contentEl) return;

    const categoryClass = step.category || 'other';
    const metadataHtml = step.events.length > 0 && step.events[0].metadata
      ? `<div class="trace-step-metadata">${escapeHtml(JSON.stringify(step.events[0].metadata, null, 2))}</div>`
      : '';

    contentEl.innerHTML = `
      <div class="trace-step-card ${categoryClass}">
        <div class="trace-step-header">
          <span class="trace-step-index">${t('trace.step', { step: step.index + 1 })}</span>
          <span class="trace-step-type">${escapeHtml(step.type || step.category)}</span>
          <span class="trace-step-time">${escapeHtml(step.timestamp)}</span>
        </div>
        <div class="trace-step-message">${escapeHtml(step.summary)}</div>
        ${metadataHtml}
      </div>
    `;
  }

  function updateControls() {
    if (!currentTimeline) return;

    const prevBtn = document.getElementById('trace-replay-prev');
    const nextBtn = document.getElementById('trace-replay-next');
    const stepLabel = document.getElementById('trace-replay-step');
    const playBtn = document.getElementById('trace-replay-play');

    if (prevBtn) prevBtn.disabled = currentStepIndex <= 0;
    if (nextBtn) nextBtn.disabled = currentStepIndex >= currentTimeline.steps.length - 1;
    if (stepLabel) stepLabel.textContent = t('trace.stepProgress', { current: currentStepIndex + 1, total: currentTimeline.steps.length });
    if (playBtn) {
      playBtn.innerHTML = playInterval
        ? `<svg class="icon"><use href="#icon-refresh"/></svg> ${t('trace.pause')}`
        : `<svg class="icon"><use href="#icon-play"/></svg> ${t('trace.play')}`;
    }
  }

  function updateSummary() {
    if (!currentTimeline) return;

    const totalEl = document.getElementById('trace-total-events');
    const durationEl = document.getElementById('trace-duration');
    const errorsEl = document.getElementById('trace-errors');
    const agentEl = document.getElementById('trace-agent');

    if (totalEl) totalEl.textContent = currentTimeline.metadata.totalEvents;
    if (durationEl) durationEl.textContent = formatDuration(currentTimeline.metadata.durationMs);
    if (errorsEl) errorsEl.textContent = currentTimeline.metadata.errorCount;
    if (agentEl) agentEl.textContent = currentTimeline.metadata.agentId;
  }

  function goToStep(index) {
    if (!currentTimeline || index < 0 || index >= currentTimeline.steps.length) return;
    currentStepIndex = index;
    renderStep(currentTimeline.steps[index]);
    updateControls();
    renderTimeline();
  }

  function showEmpty() {
    const contentEl = document.getElementById('trace-replay-content');
    if (contentEl) {
      contentEl.innerHTML = `<div class="trace-empty-state"><p>${t('trace.selectRun')}</p></div>`;
    }
  }

  async function loadTraceForRun(run) {
    if (!run || !run.results || run.results.length === 0) {
      currentTimeline = null;
      showEmpty();
      return;
    }

    // Find first result with a trace path
    const firstResult = run.results.find(r => r.tracePath);
    if (!firstResult) {
      currentTimeline = null;
      showEmpty();
      return;
    }

    try {
      // Import TraceReplayer dynamically
      const { TraceReplayer } = await import('./trace-replay-bridge.js');
      const source = firstResult.traceFile ?? firstResult.tracePath;
      const replayer = new TraceReplayer(source);
      currentTimeline = await replayer.buildTimeline({ stepWindowMs: 100 });
      currentStepIndex = 0;

      renderTimeline();
      renderStep(currentTimeline.steps[0]);
      updateControls();
      updateSummary();
    } catch (error) {
      console.error('Failed to load trace:', error);
      currentTimeline = null;
      showEmpty();
    }
  }

  function startPlayback() {
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = null;
      updateControls();
      return;
    }

    if (!currentTimeline || currentTimeline.steps.length === 0) return;

    playInterval = setInterval(() => {
      if (currentStepIndex >= currentTimeline.steps.length - 1) {
        currentStepIndex = 0;
      } else {
        currentStepIndex++;
      }
      renderStep(currentTimeline.steps[currentStepIndex]);
      updateControls();
      renderTimeline();
    }, 1000);

    updateControls();
  }

  function setupEventListeners() {
    const prevBtn = document.getElementById('trace-replay-prev');
    const nextBtn = document.getElementById('trace-replay-next');
    const playBtn = document.getElementById('trace-replay-play');

    if (prevBtn) prevBtn.addEventListener('click', () => goToStep(currentStepIndex - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => goToStep(currentStepIndex + 1));
    if (playBtn) playBtn.addEventListener('click', startPlayback);
  }

  function isVisible() {
    const section = document.getElementById('trace-replay-section');
    return section && !section.classList.contains('hidden');
  }

  function show() {
    const section = document.getElementById('trace-replay-section');
    if (section) section.classList.remove('hidden');
  }

  function hide() {
    const section = document.getElementById('trace-replay-section');
    if (section) section.classList.add('hidden');
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = null;
    }
  }

  return {
    loadTraceForRun,
    show,
    hide,
    isVisible,
    setupEventListeners
  };
}
