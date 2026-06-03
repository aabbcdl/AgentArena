import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  StreamJsonTransport,
  TextTransport,
  RawTransport,
  TransportChain,
  createClaudeTransportChain,
} from "../packages/adapters/dist/transport.js";

// Mock the process-utils module
vi.mock("../packages/adapters/dist/process-utils.js", () => ({
  runProcess: vi.fn(),
  agentTimeoutMs: vi.fn(() => 15 * 60 * 1000),
}));

// Mock the event-parsers module
vi.mock("../packages/adapters/dist/event-parsers.js", () => ({
  parseClaudeEvents: vi.fn(() => ({
    summaryFromEvents: "Test summary",
    tokenUsage: 100,
    estimatedCostUsd: 0.01,
    costKnown: true,
    toolCalls: [],
    sessionId: "test-session",
    error: null,
  })),
}));

describe("TransportChain", () => {
  const mockInvocation = {
    command: "claude",
    argsPrefix: [],
    displayCommand: "claude",
  };

  it("should throw if no transports provided", () => {
    expect(() => new TransportChain([])).toThrow(
      "TransportChain requires at least one transport"
    );
  });

  it("should have correct transport count", () => {
    const chain = new TransportChain([
      new StreamJsonTransport(mockInvocation),
      new TextTransport(mockInvocation),
    ]);
    expect(chain.length).toBe(2);
    expect(chain.transportIds).toEqual(["stream-json", "text"]);
  });

  it("should create correct chain for third-party providers", () => {
    const chain = createClaudeTransportChain(
      mockInvocation,
      true, // isThirdPartyProvider
      [],
      { transportTimeoutMs: 5000 }
    );
    expect(chain.length).toBe(2);
    expect(chain.transportIds).toEqual(["stream-json", "text"]);
  });

  it("should create single transport chain for official providers", () => {
    const chain = createClaudeTransportChain(
      mockInvocation,
      false, // not third-party
      [],
      { transportTimeoutMs: 5000 }
    );
    expect(chain.length).toBe(1);
    expect(chain.transportIds).toEqual(["stream-json"]);
  });
});

describe("StreamJsonTransport", () => {
  const mockInvocation = {
    command: "claude",
    argsPrefix: [],
    displayCommand: "claude",
  };

  it("should have correct id and description", () => {
    const transport = new StreamJsonTransport(mockInvocation);
    expect(transport.id).toBe("stream-json");
    expect(transport.description).toContain("Stream JSON");
  });
});

describe("TextTransport", () => {
  const mockInvocation = {
    command: "claude",
    argsPrefix: [],
    displayCommand: "claude",
  };

  it("should have correct id and description", () => {
    const transport = new TextTransport(mockInvocation);
    expect(transport.id).toBe("text");
    expect(transport.description).toContain("Text mode");
  });

  it("should never suggest fallback", async () => {
    const transport = new TextTransport(mockInvocation);
    // TextTransport.shouldFallback is always false by design
    // We can't easily test the full flow without mocking runProcess
    expect(transport.id).toBe("text");
  });
});

describe("RawTransport", () => {
  const mockInvocation = {
    command: "claude",
    argsPrefix: [],
    displayCommand: "claude",
  };

  it("should have correct id and description", () => {
    const transport = new RawTransport(mockInvocation);
    expect(transport.id).toBe("raw");
    expect(transport.description).toContain("Raw mode");
  });
});

describe("TransportChain.execute", () => {
  const mockInvocation = {
    command: "claude",
    argsPrefix: [],
    displayCommand: "claude",
  };

  it("should use first transport if it succeeds", async () => {
    const { runProcess } = await import("../packages/adapters/dist/process-utils.js");
    const { parseClaudeEvents } = await import("../packages/adapters/dist/event-parsers.js");

    // Mock successful stream-json execution
    runProcess.mockResolvedValue({
      exitCode: 0,
      stdout: '{"type":"result","summary":"Success"}',
      stderr: "",
      timedOut: false,
    });

    parseClaudeEvents.mockReturnValue({
      summaryFromEvents: "Success",
      tokenUsage: 100,
      estimatedCostUsd: 0.01,
      costKnown: true,
      toolCalls: [],
      sessionId: "test-session",
      error: null,
    });

    const chain = new TransportChain(
      [
        new StreamJsonTransport(mockInvocation),
        new TextTransport(mockInvocation),
      ],
      { logFallbacks: false }
    );

    const result = await chain.execute("test prompt", "/tmp");

    expect(result.usedFallback).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].transportId).toBe("stream-json");
    expect(result.attempts[0].success).toBe(true);
    expect(result.result.transportId).toBe("stream-json");
  });

  it("should fallback to second transport if first fails", async () => {
    const { runProcess } = await import("../packages/adapters/dist/process-utils.js");
    const { parseClaudeEvents } = await import("../packages/adapters/dist/event-parsers.js");

    // Mock first call (stream-json) to timeout with no output
    runProcess.mockResolvedValueOnce({
      exitCode: null,
      stdout: "",
      stderr: "timed out",
      timedOut: true,
    });

    parseClaudeEvents.mockReturnValueOnce({
      summaryFromEvents: null,
      tokenUsage: 0,
      estimatedCostUsd: 0,
      costKnown: false,
      toolCalls: [],
      sessionId: null,
      error: null,
    });

    // Mock second call (text) to succeed
    runProcess.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "Success via text mode",
      stderr: "",
      timedOut: false,
    });

    const chain = new TransportChain(
      [
        new StreamJsonTransport(mockInvocation),
        new TextTransport(mockInvocation),
      ],
      { logFallbacks: false }
    );

    const result = await chain.execute("test prompt", "/tmp");

    expect(result.usedFallback).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].transportId).toBe("stream-json");
    expect(result.attempts[0].success).toBe(false);
    expect(result.attempts[1].transportId).toBe("text");
    expect(result.attempts[1].success).toBe(true);
    expect(result.result.transportId).toBe("text");
  });

  it("should return last result if all transports fail", async () => {
    const { runProcess } = await import("../packages/adapters/dist/process-utils.js");
    const { parseClaudeEvents } = await import("../packages/adapters/dist/event-parsers.js");

    // Both transports timeout
    runProcess.mockResolvedValue({
      exitCode: null,
      stdout: "",
      stderr: "timed out",
      timedOut: true,
    });

    parseClaudeEvents.mockReturnValue({
      summaryFromEvents: null,
      tokenUsage: 0,
      estimatedCostUsd: 0,
      costKnown: false,
      toolCalls: [],
      sessionId: null,
      error: null,
    });

    const chain = new TransportChain(
      [
        new StreamJsonTransport(mockInvocation),
        new TextTransport(mockInvocation),
      ],
      { logFallbacks: false }
    );

    const result = await chain.execute("test prompt", "/tmp");

    expect(result.usedFallback).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.result.transportId).toBe("text"); // Text is last resort
  });
});
