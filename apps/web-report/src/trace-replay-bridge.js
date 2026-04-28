/**
 * Bridge module for TraceReplayer
 * Provides compatibility layer between browser and Node.js trace module.
 */
export class TraceReplayer {
  constructor(source) {
    this.source = source;
    this.events = null;
  }

  async loadEvents() {
    if (this.events) return this.events;

    const text = await this.readSourceText();
    const lines = text.split('\n').filter(line => line.trim());
    this.events = lines
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(event => event !== null);

    this.events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return this.events;
  }

  async readSourceText() {
    if (typeof Blob !== "undefined" && this.source instanceof Blob) {
      return await this.source.text();
    }

    const response = await fetch(String(this.source));
    if (!response.ok) {
      throw new Error(`Failed to load trace source: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }

  async buildTimeline(options = {}) {
    let events = await this.loadEvents();

    if (options.filter) {
      events = events.filter(e => this.matchesFilter(e, options.filter));
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

    const stepWindowMs = options.stepWindowMs ?? 100;
    const steps = this.groupEventsIntoSteps(events, stepWindowMs);

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
        errorCount: this.countErrors(events),
        eventTypes: this.countEventTypes(events)
      }
    };
  }

  groupEventsIntoSteps(events, stepWindowMs) {
    if (events.length === 0) return [];

    const steps = [];
    let currentStep = {
      index: 0,
      timestamp: events[0].timestamp,
      events: [events[0]],
      summary: this.summarizeEvent(events[0]),
      category: this.categorizeEvent(events[0])
    };

    for (let i = 1; i < events.length; i++) {
      const event = events[i];
      const prevTime = new Date(events[i - 1].timestamp).getTime();
      const currTime = new Date(event.timestamp).getTime();
      const category = this.categorizeEvent(event);

      if (currTime - prevTime > stepWindowMs || category !== currentStep.category) {
        steps.push(currentStep);
        currentStep = {
          index: steps.length,
          timestamp: event.timestamp,
          events: [event],
          summary: this.summarizeEvent(event),
          category
        };
      } else {
        currentStep.events.push(event);
        if (currentStep.events.length === 2) {
          currentStep.summary = `${currentStep.summary} (+${currentStep.events.length - 1} more)`;
        } else {
          currentStep.summary = `${currentStep.events[0].type} (+${currentStep.events.length - 1} events)`;
        }
      }
    }

    steps.push(currentStep);
    return steps;
  }

  categorizeEvent(event) {
    const type = event.type.toLowerCase();
    if (type.startsWith('setup')) return 'setup';
    if (type.startsWith('teardown')) return 'teardown';
    if (type.startsWith('judge')) return 'judge';
    if (type.startsWith('adapter')) return 'agent';
    if (type.startsWith('snapshot')) return 'snapshot';
    if (type.startsWith('preflight')) return 'preflight';
    return 'other';
  }

  summarizeEvent(event) {
    const prefix = `[${event.type}]`;
    const message = event.message?.slice(0, 200);
    if (!message) return prefix;
    return `${prefix} ${message}`;
  }

  countErrors(events) {
    return events.filter(e =>
      e.type.includes('error') ||
      e.type.includes('failed') ||
      e.type.includes('failure') ||
      e.metadata?.error !== undefined
    ).length;
  }

  countEventTypes(events) {
    const counts = {};
    for (const event of events) {
      counts[event.type] = (counts[event.type] || 0) + 1;
    }
    return counts;
  }

  matchesFilter(event, filter) {
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
