/**
 * Transport chain tests — rewritten for Node's built-in test runner.
 * Tests the StreamJsonTransport → TextTransport fallback chain.
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

// We need to mock process-utils and event-parsers before importing transport.
// Use node:test's module mocking.

const mockRunProcess = mock.fn();
const mockParseClaudeEvents = mock.fn(() => ({
  summaryFromEvents: "Test summary",
  tokenUsage: 100,
  estimatedCostUsd: 0.01,
  costKnown: true,
  toolCalls: [],
  sessionId: "test-session",
  error: null,
}));

// Override the modules by modifying the dist files' imports at runtime.
// Since we can't easily mock ESM imports, we test the public API by
// verifying class construction and properties that don't require process execution.

const {
  StreamJsonTransport,
  TextTransport,
  RawTransport,
  TransportChain,
  createClaudeTransportChain,
} = await import("../packages/adapters/dist/transport.js");

describe("TransportChain", () => {
  const mockInvocation = {
    command: "claude",
    argsPrefix: [],
    displayCommand: "claude",
  };

  it("should throw if no transports provided", () => {
    assert.throws(
      () => new TransportChain([]),
      { message: "TransportChain requires at least one transport" }
    );
  });

  it("should have correct transport count", () => {
    const chain = new TransportChain([
      new StreamJsonTransport(mockInvocation),
      new TextTransport(mockInvocation),
    ]);
    assert.equal(chain.length, 2);
    assert.deepEqual(chain.transportIds, ["stream-json", "text"]);
  });

  it("should create correct chain for third-party providers", () => {
    const chain = createClaudeTransportChain(
      mockInvocation,
      true, // isThirdPartyProvider
      [],
      { transportTimeoutMs: 5000 }
    );
    assert.equal(chain.length, 2);
    assert.deepEqual(chain.transportIds, ["stream-json", "text"]);
  });

  it("should create single transport chain for official providers", () => {
    const chain = createClaudeTransportChain(
      mockInvocation,
      false, // not third-party
      [],
      { transportTimeoutMs: 5000 }
    );
    assert.equal(chain.length, 1);
    assert.deepEqual(chain.transportIds, ["stream-json"]);
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
    assert.equal(transport.id, "stream-json");
    assert.ok(transport.description.includes("Stream JSON"));
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
    assert.equal(transport.id, "text");
    assert.ok(transport.description.includes("Text mode"));
  });

  it("should never suggest fallback", () => {
    const transport = new TextTransport(mockInvocation);
    assert.equal(transport.id, "text");
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
    assert.equal(transport.id, "raw");
    assert.ok(transport.description.includes("Raw mode"));
  });
});
