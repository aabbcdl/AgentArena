import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Icon, t } from "../components/ui";
import { safeCategoryClass, type TraceStep, type TraceTimeline } from "../domain/trace";
import type { Locale } from "../types";

interface TraceReplayProps {
  locale: Locale;
  timeline: TraceTimeline;
  truncated: boolean;
  /** When the timeline was built in a worker for a large trace, only the
   * first screen of steps is shipped to the main thread. `hasMore` + `onLoadFull`
   * let the user pull the full timeline without re-blocking the UI. */
  hasMore?: boolean;
  onLoadFull?: () => void;
}

function formatDuration(ms: number, _locale: Locale): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/** Cap the number of timeline markers rendered as DOM buttons. A large trace
 * (e.g. after "load full") can hold thousands of steps; rendering one button per
 * step would balloon the DOM. We keep both endpoints and the current step, then
 * sample the rest evenly so the marker count stays near `max`. */
const MAX_MARKERS = 200;
function markerIndexes(total: number, currentIndex: number, max: number = MAX_MARKERS): number[] {
  if (total <= max) return Array.from({ length: total }, (_, i) => i);
  const indexes = new Set<number>([0, total - 1, currentIndex]);
  const stride = Math.ceil(total / max);
  for (let i = 0; i < total; i += stride) indexes.add(i);
  return [...indexes].sort((a, b) => a - b);
}

function StepCard({ step }: { step: TraceStep }) {
  const categoryClass = safeCategoryClass(step.category);
  const first = step.events[0];
  const metadata = first?.metadata ? JSON.stringify(first.metadata, null, 2) : "";
  return (
    <div class={`trace-step-card trace-cat-${categoryClass}`}>
      <div class="trace-step-header">
        <span class="trace-step-index">{step.index + 1}</span>
        <span class="trace-step-type">{step.category}</span>
        <span class="trace-step-time">{step.timestamp}</span>
      </div>
      <div class="trace-step-message">{step.summary}</div>
      {metadata && <pre class="trace-step-metadata">{metadata}</pre>}
    </div>
  );
}

export function TraceReplay({ locale, timeline, truncated, hasMore, onLoadFull }: TraceReplayProps) {
  const steps = timeline.steps;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  const total = steps.length;
  const current = steps[Math.min(index, total - 1)] ?? null;

  useEffect(() => { setIndex(0); setPlaying(false); }, [timeline]);

  useEffect(() => {
    if (!playing) {
      if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; }
      return;
    }
    timer.current = window.setInterval(() => {
      setIndex((prev) => {
        if (prev >= total - 1) { setPlaying(false); return 0; }
        return prev + 1;
      });
    }, 1000);
    return () => { if (timer.current !== null) window.clearInterval(timer.current); };
  }, [playing, total]);

  const progress = total > 1 ? (index / (total - 1)) * 100 : 0;
  const meta = timeline.metadata;

  const near = useMemo(() => {
    if (!current) return [];
    const start = Math.max(0, index - 3);
    const end = Math.min(total, index + 4);
    return steps.slice(start, end);
  }, [current, index, steps, total]);

  return (
    <div class="trace-replay">
      <div class="trace-summary">
        <span><strong>{meta.totalEvents}</strong> {t(locale, "traceTotalEvents")}</span>
        <span><strong>{formatDuration(meta.durationMs, locale)}</strong> {t(locale, "duration")}</span>
        <span><strong>{meta.errorCount}</strong> {t(locale, "traceErrors")}</span>
        <span><strong>{meta.agentId}</strong> {t(locale, "traceAgent")}</span>
        {truncated && <span class="trace-truncated">{t(locale, "traceTruncated")}</span>}
      </div>

      <div class="trace-controls">
        <button type="button" class="icon-button trace-prev" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index <= 0} aria-label={t(locale, "tracePrev")}><Icon name="chevron" /></button>
        <button type="button" class={`button ${playing ? "secondary" : "primary"}`} onClick={() => setPlaying((p) => !p)}>{playing ? t(locale, "tracePause") : t(locale, "tracePlay")}</button>
        <button type="button" class="icon-button" onClick={() => setIndex((i) => Math.min(total - 1, i + 1))} disabled={index >= total - 1} aria-label={t(locale, "traceNext")}><Icon name="chevron" /></button>
        <span class="trace-progress-label">{t(locale, "traceStepProgress")?.replace("{current}", String(index + 1)).replace("{total}", String(total)) ?? `${index + 1} / ${total}`}</span>
        {hasMore && onLoadFull && (
          <button type="button" class="button ghost compact-button" onClick={onLoadFull}>{t(locale, "traceLoadFull")}</button>
        )}
      </div>

      <div class="timeline-track" role="presentation">
        <div class="timeline-progress" style={{ width: `${progress}%` }}></div>
        <div class="timeline-markers">
          {markerIndexes(total, index).map((i) => {
            const step = steps[i];
            return (
              <button
                type="button"
                class={`timeline-marker trace-cat-${safeCategoryClass(step.category)}${i === index ? " active" : ""}`}
                style={{ left: `${total > 1 ? (i / (total - 1)) * 100 : 0}%` }}
                title={`${step.category}: ${step.summary}`}
                aria-label={`${t(locale, "traceStep")?.replace("{step}", String(i + 1)) ?? `Step ${i + 1}`}`}
                onClick={() => setIndex(i)}
              />
            );
          })}
        </div>
      </div>

      <div class="trace-stage" aria-live="polite">
        {current ? <StepCard step={current} /> : <p class="muted-line">{t(locale, "traceNoStep")}</p>}
      </div>

      {near.length > 1 && (
        <details class="trace-near">
          <summary>{t(locale, "traceNearby")}</summary>
          <div class="trace-near-list">
            {near.map((step, i) => {
              const realIndex = Math.max(0, index - 3) + i;
              return (
                <button type="button" key={realIndex} class={`trace-near-item ${realIndex === index ? "active" : ""}`} onClick={() => setIndex(realIndex)}>
                  <small>{realIndex + 1}</small> <span>{step.summary}</span>
                </button>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
