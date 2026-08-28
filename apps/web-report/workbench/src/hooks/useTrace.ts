import { useEffect, useRef, useState } from "preact/hooks";
import { apiFetch } from "../api/client";
import type { NormalizedAgentResult, NormalizedRun } from "../domain/run";
import { buildTimeline, type TraceEvent, type TraceTimeline } from "../domain/trace";
import { isLargeTrace, type TraceWorkerResponse } from "../workers/trace-worker";

export type TraceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; timeline: TraceTimeline; truncated: boolean; hasMore: boolean; loadFull: () => void }
  | { status: "missing" }
  | { status: "error"; message: string };

interface TraceResponse {
  runId: string;
  variantId: string;
  totalEvents: number;
  returnedEvents: number;
  truncated: boolean;
  events: TraceEvent[];
}

interface TraceLoad {
  events: TraceEvent[];
  truncated: boolean;
}

function parseEvents(text: string): TraceEvent[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as TraceEvent;
        return parsed && typeof parsed.type === "string" ? parsed : null;
      } catch {
        return null;
      }
    })
    .filter((item): item is TraceEvent => item !== null);
}

/**
 * Load the execution trace for a given run + agent result.
 *
 * - Demo runs use a bundled sample file under /workbench/public so replay works
 *   fully offline (no backend needed).
 * - Real / imported runs load through the backend /api/trace endpoint, which
 *   resolves the file from the workspace run output dir and binds identity to
 *   runId + variantId (no relative-path guessing, no cross-wiring).
 * - Large traces (>2000 events) are parsed in a Web Worker so the main
 *   thread only renders the first screen of steps; the full timeline is pulled
 *   on demand via `loadFull`. Worker failure falls back to main-thread parsing.
 *
 * Every failure degrades to a textual state — replay never throws into the page.
 */
export function useTrace(run: NormalizedRun | null, result: NormalizedAgentResult | null): TraceState {
  const [state, setState] = useState<TraceState>({ status: "idle" });
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    const variantId = result?.variantId ?? null;
    const runId = run?.runId ?? null;

    if (!run || !result || !variantId || result.traceAvailability === "missing" || run.raw.summaryOnly === true) {
      setState({ status: "missing" });
      return;
    }

    const loadBuiltIn = async (): Promise<TraceLoad> => {
      const res = await fetch(`trace-${variantId}.jsonl`, { cache: "no-store" });
      if (!res.ok) throw new Error(`builtin-trace-${res.status}`);
      return { events: parseEvents(await res.text()), truncated: false };
    };

    const loadRemote = async (): Promise<TraceLoad> => {
      const data = await apiFetch<TraceResponse>(`/api/trace?runId=${encodeURIComponent(runId ?? "")}&variantId=${encodeURIComponent(variantId)}`);
      return { events: data.events, truncated: data.truncated };
    };

    const toReady = (timeline: TraceTimeline, truncated: boolean) => {
      if (cancelled) return;
      if (timeline.metadata.totalEvents === 0) {
        setState({ status: "missing" });
        return;
      }
      setState({ status: "ready", timeline, truncated, hasMore: false, loadFull: () => undefined });
    };

    const toReadyFromWorker = (response: TraceWorkerResponse, truncated: boolean) => {
      if (cancelled) return;
      const timeline: TraceTimeline = { steps: response.steps, metadata: response.metadata };
      const hasMore = response.totalSteps > response.first500.length;
      setState({
        status: "ready",
        timeline: { steps: hasMore ? response.first500 : response.steps, metadata: response.metadata },
        truncated,
        hasMore,
        loadFull: () => {
          if (cancelled) return;
          setState({ status: "ready", timeline, truncated, hasMore: false, loadFull: () => undefined });
        }
      });
    };

    const source = run.source.kind === "demo" ? loadBuiltIn() : loadRemote();

    source.then(({ events, truncated }) => {
      if (cancelled) return;
      if (events.length === 0) {
        setState({ status: "missing" });
        return;
      }
      // Large traces are built off the main thread; small ones are cheap enough inline.
      if (!isLargeTrace(events.length)) {
        toReady(buildTimeline(events), truncated);
        return;
      }
      try {
        const worker = new Worker(new URL("../workers/trace-worker.ts", import.meta.url), { type: "module" });
        workerRef.current = worker;
        worker.onmessage = (event: MessageEvent<TraceWorkerResponse>) => {
          toReadyFromWorker(event.data, truncated);
          worker.terminate();
          workerRef.current = null;
        };
        worker.onerror = () => {
          // Worker unavailable (e.g. unsupported env): fall back to main thread.
          toReady(buildTimeline(events), truncated);
          worker.terminate();
          workerRef.current = null;
        };
        worker.postMessage({ events });
      } catch {
        toReady(buildTimeline(events), truncated);
      }
    }).catch((error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      // A 404 from the backend means the trace file is genuinely absent.
      if (message.includes("trace-missing") || message.includes("404")) {
        setState({ status: "missing" });
      } else {
        setState({ status: "error", message });
      }
    });

    return () => {
      cancelled = true;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [run, result]);

  return state;
}
