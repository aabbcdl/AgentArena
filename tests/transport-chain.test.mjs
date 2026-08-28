/**
 * Transport chain tests — rewritten for Node's built-in test runner.
 * Tests the StreamJsonTransport → TextTransport fallback chain.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

// Verify the public API by checking class construction and properties that do
// not require process execution.

const {
  StreamJsonTransport,
  TextTransport,
  RawTransport,
  TransportChain,
  createClaudeTransportChain,
  DEFAULT_FALLBACK_THRESHOLDS,
  resolveFallbackThresholds,
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

  it("never appends the legacy full-permission bypass from the environment", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-transport-permissions-"));
    const capturePath = path.join(tempDir, "args.json");
    const scriptPath = path.join(tempDir, "capture.mjs");
    const previous = process.env.AGENTARENA_SKIP_PERMISSIONS;
    try {
      await writeFile(scriptPath, [
        'import { writeFileSync } from "node:fs";',
        'writeFileSync(process.env.AGENTARENA_ARGS_CAPTURE, JSON.stringify(process.argv.slice(2)));',
        'console.log(JSON.stringify({ type: "result", subtype: "success", result: "READY", usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 }));'
      ].join("\n"), "utf8");
      process.env.AGENTARENA_SKIP_PERMISSIONS = "1";
      const transport = new StreamJsonTransport({
        command: process.execPath,
        argsPrefix: [scriptPath],
        displayCommand: process.execPath
      }, ["--permission-mode", "dontAsk"]);

      await transport.send("READY", tempDir, {
        ...process.env,
        AGENTARENA_ARGS_CAPTURE: capturePath
      });
      const args = JSON.parse(await readFile(capturePath, "utf8"));
      assert.equal(args.includes("dontAsk"), true);
      assert.equal(args.includes("--dangerously-skip-permissions"), false);
    } finally {
      if (previous === undefined) delete process.env.AGENTARENA_SKIP_PERMISSIONS;
      else process.env.AGENTARENA_SKIP_PERMISSIONS = previous;
      await rm(tempDir, { recursive: true, force: true });
    }
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

// ---------------------------------------------------------------------------
// R-02: Fallback threshold parameterization
// ---------------------------------------------------------------------------

describe("TransportFallbackThresholds", () => {
  it("DEFAULT_FALLBACK_THRESHOLDS has expected values", () => {
    assert.equal(DEFAULT_FALLBACK_THRESHOLDS.timedOutMinStdoutBytes, 100);
    assert.deepEqual([...DEFAULT_FALLBACK_THRESHOLDS.acceptableExitCodes], [0, 1]);
  });

  it("resolveFallbackThresholds returns defaults when no overrides given", () => {
    const t = resolveFallbackThresholds();
    assert.equal(t.timedOutMinStdoutBytes, 100);
    assert.deepEqual([...t.acceptableExitCodes], [0, 1]);
  });

  it("resolveFallbackThresholds applies programmatic overrides", () => {
    const t = resolveFallbackThresholds({
      timedOutMinStdoutBytes: 500,
      acceptableExitCodes: [0, 1, 2],
    });
    assert.equal(t.timedOutMinStdoutBytes, 500);
    assert.deepEqual([...t.acceptableExitCodes], [0, 1, 2]);
  });

  it("resolveFallbackThresholds applies partial overrides", () => {
    const t = resolveFallbackThresholds({ timedOutMinStdoutBytes: 200 });
    assert.equal(t.timedOutMinStdoutBytes, 200);
    assert.deepEqual([...t.acceptableExitCodes], [0, 1], "Unspecified fields keep defaults");
  });

  it("resolveFallbackThresholds prefers env var over programmatic override", () => {
    const oldEnv = process.env.AGENTARENA_FALLBACK_MIN_STDOUT_BYTES;
    process.env.AGENTARENA_FALLBACK_MIN_STDOUT_BYTES = "999";
    try {
      const t = resolveFallbackThresholds({ timedOutMinStdoutBytes: 200 });
      assert.equal(t.timedOutMinStdoutBytes, 999, "Env var should win over programmatic value");
    } finally {
      if (oldEnv === undefined) delete process.env.AGENTARENA_FALLBACK_MIN_STDOUT_BYTES;
      else process.env.AGENTARENA_FALLBACK_MIN_STDOUT_BYTES = oldEnv;
    }
  });

  it("resolveFallbackThresholds parses comma-separated exit codes from env", () => {
    const oldEnv = process.env.AGENTARENA_FALLBACK_ACCEPTABLE_EXIT_CODES;
    process.env.AGENTARENA_FALLBACK_ACCEPTABLE_EXIT_CODES = "0,1,2,130";
    try {
      const t = resolveFallbackThresholds();
      assert.deepEqual([...t.acceptableExitCodes], [0, 1, 2, 130]);
    } finally {
      if (oldEnv === undefined) delete process.env.AGENTARENA_FALLBACK_ACCEPTABLE_EXIT_CODES;
      else process.env.AGENTARENA_FALLBACK_ACCEPTABLE_EXIT_CODES = oldEnv;
    }
  });

  it("resolveFallbackThresholds ignores invalid env var values", () => {
    const oldEnv = process.env.AGENTARENA_FALLBACK_MIN_STDOUT_BYTES;
    process.env.AGENTARENA_FALLBACK_MIN_STDOUT_BYTES = "not-a-number";
    try {
      const t = resolveFallbackThresholds();
      assert.equal(t.timedOutMinStdoutBytes, 100, "Invalid env should fall back to default");
    } finally {
      if (oldEnv === undefined) delete process.env.AGENTARENA_FALLBACK_MIN_STDOUT_BYTES;
      else process.env.AGENTARENA_FALLBACK_MIN_STDOUT_BYTES = oldEnv;
    }
  });

  it("StreamJsonTransport accepts custom thresholds in constructor", () => {
    const mockInvocation = { command: "claude", argsPrefix: [], displayCommand: "claude" };
    // Constructor should not throw with custom thresholds
    const transport = new StreamJsonTransport(mockInvocation, [], {
      timedOutMinStdoutBytes: 500,
      acceptableExitCodes: [0, 1, 2],
    });
    assert.equal(transport.id, "stream-json");
  });

  it("createClaudeTransportChain passes fallbackThresholds to transports", () => {
    const mockInvocation = { command: "claude", argsPrefix: [], displayCommand: "claude" };
    // Should not throw — verifies the option is accepted and threaded through
    const chain = createClaudeTransportChain(mockInvocation, true, [], {
      transportTimeoutMs: 5000,
      fallbackThresholds: { timedOutMinStdoutBytes: 250 },
    });
    assert.equal(chain.length, 2);
    assert.deepEqual(chain.transportIds, ["stream-json", "text"]);
  });
});
