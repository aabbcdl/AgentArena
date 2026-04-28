import type { TraceEvent } from "@agentarena/core";
import { JsonlTraceRecorder, type TraceFilter } from "./index.js";

/**
 * A single step in a trace replay timeline.
 * Groups related events that occurred within a short time window.
 */
export interface TraceStep {
  /** Zero-based step index in the timeline. */
  index: number;
  /** ISO timestamp of the first event in this step. */
  timestamp: string;
  /** Events that belong to this step. */
  events: TraceEvent[];
  /** Human-readable summary of this step. */
  summary: string;
  /** Step category for filtering (e.g., "setup", "agent", "judge", "teardown"). */
  category: string;
}

/**
 * Timeline generated from trace events, ready for replay.
 */
export interface TraceTimeline {
  /** All steps in chronological order. */
  steps: TraceStep[];
  /** Metadata about the replay session. */
  metadata: {
    agentId: string;
    runId?: string;
    totalEvents: number;
    startTime: string;
    endTime: string;
    durationMs: number;
    errorCount: number;
    eventTypes: Record<string, number>;
  };
}

/**
 * Comparison result between two trace timelines.
 */
export interface TraceComparison {
  /** Steps only in the first timeline. */
  onlyInFirst: TraceStep[];
  /** Steps only in the second timeline. */
  onlyInSecond: TraceStep[];
  /** Steps present in both timelines (by event type). */
  inBoth: TraceStep[];
  /** Summary of differences. */
  summary: {
    firstEventCount: number;
    secondEventCount: number;
    firstDurationMs: number;
    secondDurationMs: number;
    uniqueEventTypesInFirst: string[];
    uniqueEventTypesInSecond: string[];
  };
}

/**
 * Options for trace replay.
 */
export interface TraceReplayOptions {
  /** Group events within this time window (ms) into single steps. Default: 100ms. */
  stepWindowMs?: number;
  /** Only include events matching this filter. */
  filter?: TraceFilter;
  /** Maximum number of steps to generate (0 = unlimited). Default: 0. */
  maxSteps?: number;
}

/**
 * Categorize a trace event into a replay step category.
 */
function categorizeEvent(event: TraceEvent): string {
  const type = event.type.toLowerCase();
  if (type.startsWith("setup")) return "setup";
  if (type.startsWith("teardown")) return "teardown";
  if (type.startsWith("judge")) return "judge";
  if (type.startsWith("adapter")) return "agent";
  if (type.startsWith("snapshot")) return "snapshot";
  if (type.startsWith("preflight")) return "preflight";
  return "other";
}

/**
 * Generate a human-readable summary for a trace event.
 */
function summarizeEvent(event: TraceEvent): string {
  const prefix = `[${event.type}]`;
  const message = event.message?.slice(0, 200);
  if (!message) return prefix;
  return `${prefix} ${message}`;
}

/**
 * Group sorted events into steps based on time proximity.
 */
function groupEventsIntoSteps(
  sortedEvents: TraceEvent[],
  stepWindowMs: number
): TraceStep[] {
  if (sortedEvents.length === 0) return [];

  const steps: TraceStep[] = [];
  let currentStep: TraceStep = {
    index: 0,
    timestamp: sortedEvents[0].timestamp,
    events: [sortedEvents[0]],
    summary: summarizeEvent(sortedEvents[0]),
    category: categorizeEvent(sortedEvents[0])
  };

  for (let i = 1; i < sortedEvents.length; i++) {
    const event = sortedEvents[i];
    const prevTime = new Date(sortedEvents[i - 1].timestamp).getTime();
    const currTime = new Date(event.timestamp).getTime();
    const category = categorizeEvent(event);

    // Start a new step if time gap exceeds window or category changed
    if (currTime - prevTime > stepWindowMs || category !== currentStep.category) {
      steps.push(currentStep);
      currentStep = {
        index: steps.length,
        timestamp: event.timestamp,
        events: [event],
        summary: summarizeEvent(event),
        category
      };
    } else {
      // Add to current step
      currentStep.events.push(event);
      // Update summary to reflect multiple events
      if (currentStep.events.length === 2) {
        currentStep.summary = `${currentStep.summary} (+${currentStep.events.length - 1} more events)`;
      } else {
        currentStep.summary = `${currentStep.events[0].type} (+${currentStep.events.length - 1} events)`;
      }
    }
  }

  // Push the last step
  steps.push(currentStep);
  return steps;
}

/**
 * Count error events in a trace event array.
 */
function countErrors(events: TraceEvent[]): number {
  return events.filter(
    (e) =>
      e.type.includes("error") ||
      e.type.includes("failed") ||
      e.type.includes("failure") ||
      e.metadata?.error !== undefined
  ).length;
}

/**
 * Count event types in a trace event array.
 */
function countEventTypes(events: TraceEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] || 0) + 1;
  }
  return counts;
}

/**
 * Trace replay engine.
 *
 * Loads trace events from a JSONL file, sorts them chronologically,
 * groups them into replayable steps, and supports comparison between runs.
 *
 * Example:
 * ```typescript
 * const replayer = new TraceReplayer("path/to/trace.jsonl");
 * const timeline = await replayer.buildTimeline();
 * for (const step of timeline.steps) {
 *   console.log(`Step ${step.index}: ${step.summary}`);
 * }
 * ```
 */
export class TraceReplayer {
  private events: TraceEvent[] | null = null;

  constructor(
    /** Path to the trace.jsonl file, or a JsonlTraceRecorder instance. */
    private readonly source: string | JsonlTraceRecorder
  ) {}

  /**
   * Load trace events from the source.
   * Returns events sorted by timestamp (oldest first).
   */
  async loadEvents(): Promise<TraceEvent[]> {
    if (this.events) return this.events;

    if (typeof this.source === "string") {
      const recorder = new JsonlTraceRecorder(this.source);
      this.events = await recorder.readAll();
    } else {
      this.events = await this.source.readAll();
    }

    // Sort by timestamp
    this.events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return this.events;
  }

  /**
   * Build a replay timeline from trace events.
   * Groups events into steps based on time proximity.
   */
  async buildTimeline(options: TraceReplayOptions = {}): Promise<TraceTimeline> {
    let events = await this.loadEvents();

    // Apply filter if provided
    if (options.filter) {
      const filter = options.filter;
      events = events.filter((e) => this.matchesFilter(e, filter));
    }

    if (events.length === 0) {
      return {
        steps: [],
        metadata: {
          agentId: "unknown",
          totalEvents: 0,
          startTime: "",
          endTime: "",
          durationMs: 0,
          errorCount: 0,
          eventTypes: {}
        }
      };
    }

    // Group events into steps
    const stepWindowMs = options.stepWindowMs ?? 100;
    let steps = groupEventsIntoSteps(events, stepWindowMs);

    // Apply maxSteps limit
    if (options.maxSteps && options.maxSteps > 0) {
      steps = steps.slice(0, options.maxSteps);
    }

    const startTime = events[0].timestamp;
    const endTime = events[events.length - 1].timestamp;
    const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();

    return {
      steps,
      metadata: {
        agentId: events[0].agentId,
        runId: events[0].runId,
        totalEvents: events.length,
        startTime,
        endTime,
        durationMs,
        errorCount: countErrors(events),
        eventTypes: countEventTypes(events)
      }
    };
  }

  /**
   * Step through the timeline one step at a time using an async iterator.
   *
   * Example:
   * ```typescript
   * for await (const step of replayer.stepByStep()) {
   *   console.log(step.summary);
   *   // Add artificial delay for dramatic effect
   *   await new Promise(r => setTimeout(r, 500));
   * }
   * ```
   */
  async *stepByStep(
    options: TraceReplayOptions = {}
  ): AsyncGenerator<TraceStep, void, undefined> {
    const timeline = await this.buildTimeline(options);
    for (const step of timeline.steps) {
      yield step;
    }
  }

  /**
   * Compare two trace timelines.
   * Identifies unique steps, common steps, and summarizes differences.
   */
  static async compare(
    firstSource: string | JsonlTraceRecorder,
    secondSource: string | JsonlTraceRecorder,
    options: TraceReplayOptions = {}
  ): Promise<TraceComparison> {
    const firstReplayer = new TraceReplayer(firstSource);
    const secondReplayer = new TraceReplayer(secondSource);

    const [firstTimeline, secondTimeline] = await Promise.all([
      firstReplayer.buildTimeline(options),
      secondReplayer.buildTimeline(options)
    ]);

    // Create signatures for steps to compare by actual content, not just category
    const getStepSignature = (step: TraceStep) =>
      `${step.category}:${step.timestamp}:${step.summary}`;

    const firstSignatures = new Set(firstTimeline.steps.map(getStepSignature));
    const secondSignatures = new Set(secondTimeline.steps.map(getStepSignature));

    const onlyInFirst = firstTimeline.steps.filter(
      (s) => !secondSignatures.has(getStepSignature(s))
    );
    const onlyInSecond = secondTimeline.steps.filter(
      (s) => !firstSignatures.has(getStepSignature(s))
    );
    const inBoth = firstTimeline.steps.filter((s) =>
      secondSignatures.has(getStepSignature(s))
    );

    // Collect unique categories for summary
    const firstTypes = new Set(firstTimeline.steps.map((s) => s.category));
    const secondTypes = new Set(secondTimeline.steps.map((s) => s.category));

    const uniqueFirstTypes = [...firstTypes].filter((t) => !secondTypes.has(t));
    const uniqueSecondTypes = [...secondTypes].filter((t) => !firstTypes.has(t));

    return {
      onlyInFirst,
      onlyInSecond,
      inBoth,
      summary: {
        firstEventCount: firstTimeline.metadata.totalEvents,
        secondEventCount: secondTimeline.metadata.totalEvents,
        firstDurationMs: firstTimeline.metadata.durationMs,
        secondDurationMs: secondTimeline.metadata.durationMs,
        uniqueEventTypesInFirst: uniqueFirstTypes,
        uniqueEventTypesInSecond: uniqueSecondTypes
      }
    };
  }

  /**
   * Get a summary of the trace without building a full timeline.
   * Useful for quick diagnostics.
   */
  async getTraceSummary(): Promise<{
    agentId: string;
    runId?: string;
    totalEvents: number;
    durationMs: number;
    errorCount: number;
    eventTypes: Record<string, number>;
    categories: Record<string, number>;
  } | null> {
    const events = await this.loadEvents();
    if (events.length === 0) return null;

    const startTime = events[0].timestamp;
    const endTime = events[events.length - 1].timestamp;
    const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();

    const categories: Record<string, number> = {};
    for (const event of events) {
      const cat = categorizeEvent(event);
      categories[cat] = (categories[cat] || 0) + 1;
    }

    return {
      agentId: events[0].agentId,
      runId: events[0].runId,
      totalEvents: events.length,
      durationMs,
      errorCount: countErrors(events),
      eventTypes: countEventTypes(events),
      categories
    };
  }

  /**
   * Extract judge-related events and align them with judge results.
   * This helps identify whether a judge failure was caused by agent behavior
   * or judge misconfiguration.
   */
  async extractJudgeRelevantEvents(
    _judgeResults?: Array<{ label: string; success: boolean; type: string }>
  ): Promise<{
    judgeEvents: TraceEvent[];
    setupEvents: TraceEvent[];
    teardownEvents: TraceEvent[];
    agentExecutionEvents: TraceEvent[];
    errorEvents: TraceEvent[];
  }> {
    const events = await this.loadEvents();

    return {
      judgeEvents: events.filter((e) => e.type.startsWith("judge")),
      setupEvents: events.filter((e) => e.type.startsWith("setup")),
      teardownEvents: events.filter((e) => e.type.startsWith("teardown")),
      agentExecutionEvents: events.filter((e) => e.type.startsWith("adapter")),
      errorEvents: events.filter(
        (e) =>
          e.type.includes("error") ||
          e.type.includes("failed") ||
          e.type.includes("failure") ||
          e.metadata?.error !== undefined
      )
    };
  }

  private matchesFilter(event: TraceEvent, filter: TraceFilter): boolean {
    if (filter.agentId && event.agentId !== filter.agentId) return false;
    if (filter.runId && event.runId !== filter.runId) return false;
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      if (!types.includes(event.type)) return false;
    }
    if (filter.startTime && event.timestamp < filter.startTime) return false;
    if (filter.endTime && event.timestamp > filter.endTime) return false;
    if (filter.messageContains && !event.message.toLowerCase().includes(filter.messageContains.toLowerCase())) return false;
    return true;
  }
}

/**
 * Load trace events from a file path without creating a replayer instance.
 * Convenience function for simple use cases.
 */
export async function loadTraceEvents(filePath: string): Promise<TraceEvent[]> {
  const replayer = new TraceReplayer(filePath);
  return replayer.loadEvents();
}

/**
 * Build a replay timeline from a file path without creating a replayer instance.
 * Convenience function for simple use cases.
 */
export async function buildTraceTimeline(
  filePath: string,
  options?: TraceReplayOptions
): Promise<TraceTimeline> {
  const replayer = new TraceReplayer(filePath);
  return replayer.buildTimeline(options);
}
