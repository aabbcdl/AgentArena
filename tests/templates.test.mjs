import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCiWorkflow,
  createAdhocLintCommand,
  createAdhocTestCommand,
  createNodeEvalCommand,
  createPackageScriptCommand,
  createTemplateLintCommand,
  createTemplateTestCommand,
} from "../packages/cli/dist/templates.js";

test("createNodeEvalCommand wraps source in node -e with JSON quoting", () => {
  const result = createNodeEvalCommand("console.log('hi')");
  assert.ok(result.startsWith("node -e "));
  assert.ok(result.includes("console.log"));
});

test("createPackageScriptCommand produces a node -e command", () => {
  const result = createPackageScriptCommand("test");
  assert.ok(result.startsWith("node -e "));
  assert.ok(result.includes("package.json"));
  assert.ok(result.includes("test"));
});

test("createAdhocTestCommand includes report file path", () => {
  const result = createAdhocTestCommand("report.json");
  assert.ok(result.includes("report.json"));
});

test("createTemplateTestCommand includes report file path", () => {
  const result = createTemplateTestCommand("report.json");
  assert.ok(result.includes("report.json"));
});

test("createAdhocLintCommand includes report file path", () => {
  const result = createAdhocLintCommand("lint-report.json");
  assert.ok(result.includes("lint-report.json"));
});

test("createTemplateLintCommand includes report file path", () => {
  const result = createTemplateLintCommand("lint-report.json");
  assert.ok(result.includes("lint-report.json"));
});

test("buildCiWorkflow generates valid YAML for nightly template", () => {
  const result = buildCiWorkflow({
    taskPath: "tasks/demo.yaml",
    agentIds: ["demo-fast", "demo-thorough"],
    template: "nightly",
    outputDir: ".agentarena/results",
  });
  assert.ok(result.includes("name: AgentArena Nightly Benchmark"));
  assert.ok(result.includes("schedule:"));
  assert.ok(result.includes("cron:"));
  assert.ok(result.includes("demo-fast,demo-thorough"));
  assert.ok(result.includes("tasks/demo.yaml"));
  assert.ok(result.includes(".agentarena/results"));
  assert.ok(result.includes("permissions:"));
});

test("buildCiWorkflow generates valid YAML for pull-request template", () => {
  const result = buildCiWorkflow({
    taskPath: "tasks/pr-check.yaml",
    agentIds: ["demo-fast"],
    template: "pull-request",
    outputDir: "output",
  });
  assert.ok(result.includes("name: AgentArena Benchmark"));
  assert.ok(result.includes("pull_request:"));
  assert.ok(result.includes("pull-requests: write"));
  assert.ok(result.includes("demo-fast"));
});

test("buildCiWorkflow generates valid YAML for smoke template", () => {
  const result = buildCiWorkflow({
    taskPath: "tasks/smoke.yaml",
    agentIds: ["demo-budget"],
    template: "smoke",
    outputDir: "results",
  });
  assert.ok(result.includes("name: AgentArena Smoke Benchmark"));
  assert.ok(result.includes("push:"));
});

test("buildCiWorkflow normalizes Windows paths", () => {
  const result = buildCiWorkflow({
    taskPath: "tasks\\windows\\demo.yaml",
    agentIds: ["demo-fast"],
    template: "nightly",
    outputDir: "output\\dir",
  });
  assert.ok(!result.includes("\\"));
  assert.ok(result.includes("tasks/windows/demo.yaml"));
  assert.ok(result.includes("output/dir"));
});

test("buildCiWorkflow shell-quotes user-controlled run arguments", () => {
  const result = buildCiWorkflow({
    taskPath: "tasks/demo task's.yaml",
    agentIds: ["demo-fast", "codex;echo injected"],
    template: "pull-request",
    outputDir: ".agentarena/ci output's",
  });

  assert.ok(result.includes("mkdir -p '.agentarena/ci output'\"'\"'s'"));
  assert.ok(result.includes("--task 'tasks/demo task'\"'\"'s.yaml'"));
  assert.ok(result.includes("--agents 'demo-fast,codex;echo injected'"));
  assert.ok(result.includes("--output '.agentarena/ci output'\"'\"'s'"));
  assert.ok(result.includes("> '.agentarena/ci output'\"'\"'s/run.json'"));
  assert.ok(result.includes('fs.readFileSync(".agentarena/ci output\'s/pr-comment.md", "utf8")'));
});

test("buildCiWorkflow rejects line breaks in user-controlled values", () => {
  assert.throws(
    () =>
      buildCiWorkflow({
        taskPath: "tasks/demo.yaml\nmalicious",
        agentIds: ["demo-fast"],
        template: "smoke",
        outputDir: "results",
      }),
    /task path cannot contain line breaks/,
  );
  assert.throws(
    () =>
      buildCiWorkflow({
        taskPath: "tasks/demo.yaml",
        agentIds: ["demo-fast\nmalicious"],
        template: "smoke",
        outputDir: "results",
      }),
    /agent list cannot contain line breaks/,
  );
  assert.throws(
    () =>
      buildCiWorkflow({
        taskPath: "tasks/demo.yaml",
        agentIds: ["demo-fast"],
        template: "smoke",
        outputDir: "results\nmalicious",
      }),
    /output directory cannot contain line breaks/,
  );
});
