export function createNodeEvalCommand(source: string): string {
  return `node -e ${JSON.stringify(source)}`;
}

export function createPackageScriptCommand(scriptName: string): string {
  return createNodeEvalCommand(`
const { existsSync, readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const pkgPath = "package.json";
if (!existsSync(pkgPath)) {
  console.error("❌ 找不到 package.json 文件");
  console.error("原因：任务包需要 package.json 来定义项目配置和依赖");
  console.error("解决方法：在项目根目录运行 'npm init' 或 'pnpm init' 创建 package.json");
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (!pkg.scripts || !pkg.scripts[${JSON.stringify(scriptName)}]) {
  console.error(${JSON.stringify(`❌ package.json 中缺少 "${scriptName}" 脚本`)});
  console.error(${JSON.stringify(`原因：需要 ${scriptName} 脚本来执行相关任务`)});
  console.error(${JSON.stringify(`解决方法：在 package.json 的 "scripts" 中添加："${scriptName}": "..."`)});
  process.exit(1);
}
for (const [cmd, args] of [["pnpm", ["run", ${JSON.stringify(scriptName)}]], ["npm", ["run", ${JSON.stringify(scriptName)}]]]) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (!result.error) {
    process.exit(result.status ?? 1);
  }
}
console.error(${JSON.stringify(`❌ 无法使用 pnpm 或 npm 执行 "${scriptName}" 脚本`)});
console.error(${JSON.stringify(`原因：pnpm 和 npm 都无法运行该脚本，可能是脚本配置错误或依赖缺失`)});
console.error(${JSON.stringify(`解决方法：检查 package.json 中的 ${scriptName} 脚本配置，确保命令正确且依赖已安装`)});
process.exit(1);
`.trim());
}

function createTestCommand(reportFile: string, options: { requireTestScript: boolean }): string {
  return createNodeEvalCommand(`
const { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const { spawnSync } = require("node:child_process");
const pkgPath = "package.json";
const reportFileValue = ${JSON.stringify(reportFile)};
mkdirSync(dirname(reportFileValue), { recursive: true });
if (!existsSync(pkgPath)) {
  ${options.requireTestScript
    ? `console.error("❌ 找不到 package.json 文件");\n  console.error("原因：测试检查需要 package.json 来确认项目配置");\n  console.error("解决方法：在项目根目录运行 'npm init' 或 'pnpm init' 创建 package.json");\n  process.exit(1);`
    : `writeFileSync(reportFileValue, JSON.stringify({ success: true, numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0 }, null, 2));\n  process.exit(0);`}
}
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (!pkg.scripts || !pkg.scripts.test) {
  ${options.requireTestScript
    ? `console.error("❌ package.json 中缺少 test 脚本");\n  console.error("原因：无法执行测试，test 脚本未定义");\n  console.error("解决方法：在 package.json 的 scripts 中添加：\\"test\\": \\"echo \\\\\\"Error: no test specified\\\\\\" && exit 1\\"");\n  process.exit(1);`
    : `writeFileSync(reportFileValue, JSON.stringify({ success: true, numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0 }, null, 2));\n  process.exit(0);`}
}
const candidates = [
  ["pnpm", ["test", "--", "--runInBand", "--json", "--outputFile", reportFileValue]],
  ["pnpm", ["test", "--", "--runInBand", "--reporter=json", "--outputFile", reportFileValue]],
  ["npm", ["run", "test", "--", "--runInBand", "--json", "--outputFile", reportFileValue]],
  ["npm", ["run", "test", "--", "--runInBand", "--reporter=json", "--outputFile", reportFileValue]]
];
let lastStatus = 1;
for (const [cmd, args] of candidates) {
  rmSync(reportFileValue, { force: true });
  const result = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", shell: process.platform === "win32" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!result.error && existsSync(reportFileValue) && statSync(reportFileValue).size > 0) {
    process.exit(result.status ?? 1);
  }
  lastStatus = result.status ?? 1;
}
${options.requireTestScript
    ? ""
    : `writeFileSync(reportFileValue, JSON.stringify({ success: true, numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0 }, null, 2));`}
console.error("❌ 无法捕获 Jest/Vitest JSON 测试输出");
console.error("原因：pnpm 和 npm 都无法获取测试报告的 JSON 输出");
console.error("解决方法：");
console.error("  1. 确认已安装 Jest 或 Vitest：npm install --save-dev jest vitest");
console.error("  2. 确认 test 脚本正确配置（如：\\"test\\": \\"vitest --runInBand --reporter=json\\"）");
console.error("  3. 手动运行测试确认能正常执行：pnpm test");
process.exit(lastStatus || 1);
`.trim());
}

export function createAdhocTestCommand(reportFile: string): string {
  return createTestCommand(reportFile, { requireTestScript: true });
}

export function createTemplateTestCommand(reportFile: string): string {
  return createTestCommand(reportFile, { requireTestScript: false });
}

function createLintCommand(reportFile: string, options: { requireLintConfig: boolean }): string {
  return createNodeEvalCommand(`
const { existsSync, mkdirSync, statSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const { spawnSync } = require("node:child_process");
const reportFileValue = ${JSON.stringify(reportFile)};
mkdirSync(dirname(reportFileValue), { recursive: true });
const hasBiome = existsSync("biome.json");
const eslintConfigs = ["eslint.config.js", "eslint.config.mjs", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json"];
const hasEslint = eslintConfigs.some((file) => existsSync(file));
if (!hasBiome && !hasEslint) {
  ${options.requireLintConfig
    ? `console.error("❌ 找不到 Biome 或 ESLint 配置文件");\n  console.error("原因：lint-check 检查需要配置 Biome 或 ESLint");\n  console.error("解决方法：");\n  console.error("  1. 使用 Biome：创建 biome.json 配置文件");\n  console.error("  2. 使用 ESLint：创建 eslint.config.js 或 .eslintrc 配置文件");\n  console.error("  3. 或安装对应工具：npm install --save-dev @biomejs/biome eslint");\n  process.exit(1);`
    : `writeFileSync(reportFileValue, JSON.stringify([], null, 2));\n  process.exit(0);`}
}
const candidates = hasBiome
  ? [["pnpm", ["exec", "biome", "check", ".", "--reporter=json"]], ["npx", ["@biomejs/biome", "check", ".", "--reporter=json"]]]
  : [["pnpm", ["exec", "eslint", ".", "--format", "json"]], ["npx", ["eslint", ".", "--format", "json"]]];
let lastStatus = 1;
for (const [cmd, args] of candidates) {
  const result = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", shell: process.platform === "win32" });
  if (!result.error) {
    const lintOutput = result.stdout || "[]";
    writeFileSync(reportFileValue, lintOutput);
    if (result.stderr) process.stderr.write(result.stderr);
    // 只有当lint输出有效（非空且不是"[]"）且状态为0时才认为成功
    if (result.status === 0 && lintOutput !== "[]") {
      process.exit(result.status ?? 1);
    }
  }
  lastStatus = result.status ?? 1;
}
console.error("❌ 无法使用 Biome 或 ESLint 执行代码检查");
console.error("原因：Biome 和 ESLint 都无法正常运行");
console.error("解决方法：");
console.error("  1. 确认已安装 Biome 或 ESLint：npm install --save-dev @biomejs/biome eslint");
console.error("  2. 确认配置文件存在（biome.json 或 eslint.config.js）");
console.error("  3. 手动运行检查确认能正常执行：npx @biomejs/biome check . 或 npx eslint .");
process.exit(lastStatus || 1);
`.trim());
}

export function createAdhocLintCommand(reportFile: string): string {
  return createLintCommand(reportFile, { requireLintConfig: true });
}

export function createTemplateLintCommand(reportFile: string): string {
  return createLintCommand(reportFile, { requireLintConfig: false });
}

export const TASKPACK_TEMPLATES: Record<string, string> = {
  "repo-health": `schemaVersion: agentarena.taskpack/v1
id: repo-health
title: Repository Health
description: Checks that a repository stays structurally healthy after an agent task.
metadata:
  source: official
  owner: AgentArena
  objective: Validate that an agent can make a minimal repository-safe improvement.
  repoTypes:
    - node
    - generic
  tags:
    - repo-health
    - maintenance
  dependencies: []
  judgeRationale: README and package manifest presence are baseline repository health signals.
prompt: |
  Review the repository and make the smallest useful change that improves correctness,
  reliability, or maintainability. Keep changes scoped and preserve existing behavior
  unless a test or fixture shows otherwise.
expectedChangedPaths:
  - src/**/*.{js,mjs,ts,tsx}
  - packages/**/src/**/*.{js,mjs,ts,tsx}
  - lib/**/*.{js,mjs,ts,tsx}
  - README.md
envAllowList: []
judges:
  - id: readme-exists
    type: file-exists
    label: README exists
    path: README.md
  - id: package-json-exists
    type: file-exists
    label: package.json exists
    path: package.json
  - id: tests-pass
    type: test-result
    label: Tests still pass when available
    command: ${JSON.stringify(createTemplateTestCommand(".agentarena/repo-health-tests.json"))}
    format: auto
    reportFile: .agentarena/repo-health-tests.json
    passOnNoTests: true
    timeoutMs: 120000
  - id: lint-clean
    type: lint-check
    label: Lint stays clean when configured
    command: ${JSON.stringify(createTemplateLintCommand(".agentarena/repo-health-lint.json"))}
    format: auto
    reportFile: .agentarena/repo-health-lint.json
    maxWarnings: 0
    timeoutMs: 120000
`,
  "json-api": `schemaVersion: agentarena.taskpack/v1
id: json-api-contract
title: JSON API Contract
description: Validates a JSON fixture against value assertions and schema expectations.
metadata:
  source: official
  owner: AgentArena
  objective: Verify that an agent can repair a JSON contract without breaking the payload shape.
  repoTypes:
    - node
    - api
    - backend
  tags:
    - json
    - api
    - contract
  dependencies: []
  judgeRationale: JSON value and schema judges capture correctness more reliably than string matching.
prompt: |
  Update the implementation so the generated JSON output matches the expected contract
  and values described by the task pack.
expectedChangedPaths:
  - fixtures/response.json
judges:
  - id: api-schema
    type: json-schema
    label: API payload matches schema
    path: fixtures/response.json
    schemaPath: fixtures/response.schema.json
  - id: api-status
    type: json-value
    label: Status stays ready
    path: fixtures/response.json
    pointer: /status
    expected: ready
`,
  snapshot: `schemaVersion: agentarena.taskpack/v1
id: snapshot-regression
title: Snapshot Regression
description: Exercises snapshot-based regression repair workflows.
metadata:
  source: official
  owner: AgentArena
  objective: Verify that an agent can bring generated output back in sync with a stored fixture.
  repoTypes:
    - node
    - frontend
    - test
  tags:
    - snapshot
    - regression
  dependencies:
    - node
  judgeRationale: Snapshot parity is a strong proxy for fixture repair tasks when exact output matters.
prompt: |
  Update the implementation so the generated output matches the stored snapshot fixture.
expectedChangedPaths:
  - scripts/**/*.{js,mjs,ts,tsx}
  - src/**/*.{js,mjs,ts,tsx}
  - packages/**/src/**/*.{js,mjs,ts,tsx}
setupCommands:
  - id: prepare-output
    label: Prepare output fixture
    command: node scripts/generate-output.js
judges:
  - id: output-snapshot
    type: snapshot
    label: Output matches snapshot
    path: fixtures/actual.txt
    snapshotPath: fixtures/expected.txt
`,
  "compilation-check": `schemaVersion: agentarena.taskpack/v1
id: compilation-check
title: Compilation Check
description: Verifies that the project still builds after agent modifications.
metadata:
  source: official
  owner: AgentArena
  objective: Ensure the agent does not break the build pipeline.
  repoTypes:
    - node
    - typescript
    - rust
    - go
  tags:
    - compilation
    - build
    - regression
  dependencies: []
  judgeRationale: A successful compilation is the strongest signal that code is syntactically and semantically valid.
prompt: |
  Make a small improvement to the codebase. Ensure the project still compiles
  and all existing functionality is preserved.
expectedChangedPaths:
  - src/**/*.{js,mjs,ts,tsx}
  - packages/**/src/**/*.{js,mjs,ts,tsx}
setupCommands:
  - id: install-deps
    label: Install dependencies
    command: npm install
    timeoutMs: 120000
judges:
  - id: build-succeeds
    type: compilation
    label: Project compiles successfully
    tool: auto
    timeoutMs: 180000
    critical: true
`,
  "directory-structure": `schemaVersion: agentarena.taskpack/v1
id: directory-structure
title: Directory Structure Validation
description: Verifies that an agent creates the expected directory structure.
metadata:
  source: official
  owner: AgentArena
  objective: Check that an agent can scaffold a project with the correct folder layout.
  repoTypes:
    - node
    - generic
  tags:
    - scaffolding
    - structure
  dependencies: []
  judgeRationale: Directory existence validates project scaffolding correctness.
prompt: |
  Create a well-structured project scaffold with the expected directories and files.
  Include at minimum: src/, tests/, and a README.md at the root.
expectedChangedPaths:
  - src/**
  - tests/**
  - README.md
judges:
  - id: src-dir-exists
    type: directory-exists
    label: src directory exists
    path: src
    critical: true
  - id: tests-dir-exists
    type: directory-exists
    label: tests directory exists
    path: tests
    critical: true
  - id: readme-exists
    type: file-exists
    label: README exists
    path: README.md
    critical: true
`,
  "full-e2e": `schemaVersion: agentarena.taskpack/v1
id: full-e2e-validation
title: Full E2E Validation
description: Comprehensive task pack demonstrating all judge types and advanced features.
metadata:
  source: official
  owner: AgentArena
  difficulty: hard
  objective: Full end-to-end validation of agent capabilities across multiple dimensions.
  repoTypes:
    - node
    - typescript
  tags:
    - e2e
    - comprehensive
    - advanced
  dependencies:
    - node
  judgeRationale: Uses multiple judge types to validate correctness, quality, and efficiency.
  interactionModel: multi-turn
  requirementClarity: precise
prompt: |
  Implement a feature that adds authentication middleware to the Express API.
  Ensure all tests pass, lint is clean, and the output follows the expected JSON schema.
expectedChangedPaths:
  - src/**/*.ts
  - tests/**/*.test.ts
envAllowList:
  - NODE_ENV
  - CI
setupCommands:
  - id: install-deps
    label: Install dependencies
    command: npm install
    timeoutMs: 120000
    envAllowList:
      - NODE_ENV
      - CI
      - npm_config_registry
judges:
  - id: build-succeeds
    type: compilation
    label: TypeScript compilation succeeds
    tool: auto
    timeoutMs: 120000
    critical: true
  - id: unit-tests
    type: test-result
    label: Unit tests pass
    command: npm test -- --runInBand --json --outputFile .agentarena/test-report.json
    format: vitest
    reportFile: .agentarena/test-report.json
    passOnNoTests: false
    critical: true
    timeoutMs: 120000
  - id: lint-clean
    type: lint-check
    label: Lint passes with no errors
    format: auto
    reportFile: .agentarena/lint-report.json
    maxWarnings: 5
    timeoutMs: 60000
  - id: auth-middleware-exists
    type: file-exists
    label: Auth middleware file exists
    path: src/middleware/auth.ts
    critical: true
  - id: config-schema
    type: json-schema
    label: Config follows schema
    path: src/config.json
    schemaPath: schemas/config.schema.json
  - id: no-debugger
    type: regex-match
    label: No debugger statements remain
    path: src/index.ts
    pattern: "debugger"
    flags: g
    shouldNotMatch: true
    critical: true
  - id: log-pattern
    type: regex-match
    label: Proper error logging exists
    path: src/middleware/auth.ts
    pattern: "console\\.(error|warn)\\("
    flags: i
    minMatches: 2
teardownCommands:
  - id: cleanup-artifacts
    label: Clean up build artifacts
    command: rm -rf dist .agentarena
`
};

export interface CiWorkflowOptions {
  taskPath: string;
  agentIds: string[];
  template: "nightly" | "smoke" | "pull-request";
  outputDir: string;
}

export function buildCiWorkflow(options: CiWorkflowOptions): string {
  const { taskPath, agentIds, template, outputDir } = options;
  const normalizedTaskPath = taskPath.replaceAll("\\", "/");
  const normalizedAgents = agentIds.join(",");
  const normalizedOutputDir = outputDir.replaceAll("\\", "/");
  const workflowName =
    template === "nightly"
      ? "AgentArena Nightly Benchmark"
      : template === "smoke"
        ? "AgentArena Smoke Benchmark"
        : "AgentArena Benchmark";
  const permissionsBlock =
    template === "pull-request"
      ? `permissions:
  contents: read
  pull-requests: write`
      : `permissions:
  contents: read`;
  const onBlock =
    template === "nightly"
      ? `on:
  workflow_dispatch:
  schedule:
    - cron: "0 1 * * *"`
      : template === "smoke"
        ? `on:
  workflow_dispatch:
  push:
    branches:
      - main`
        : `on:
  pull_request:
  workflow_dispatch:`;
  const doctorCommand =
    template === "nightly"
      ? `node packages/cli/dist/index.js doctor --agents ${normalizedAgents} --probe-auth --strict --json > ${normalizedOutputDir}/doctor.json`
      : `node packages/cli/dist/index.js doctor --agents ${normalizedAgents} --probe-auth --json > ${normalizedOutputDir}/doctor.json`;
  const publishSummaryStep =
    template === "pull-request"
      ? `      - name: Publish benchmark summary
        run: cat ${normalizedOutputDir}/pr-comment.md >> "$GITHUB_STEP_SUMMARY"

      - name: Comment benchmark summary on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require("node:fs");
            const marker = "<!-- agentarena-benchmark-summary -->";
            const body = \`\${marker}\\n\${fs.readFileSync("${normalizedOutputDir}/pr-comment.md", "utf8")}\`;
            const issue_number = context.payload.pull_request.number;
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number
            });
            const existing = comments.find((comment) => comment.body && comment.body.includes(marker));

            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number,
                body
              });
            }`
      : `      - name: Publish benchmark summary
        run: cat ${normalizedOutputDir}/summary.md >> "$GITHUB_STEP_SUMMARY"`;
  return `name: ${workflowName}

${permissionsBlock}

${onBlock}

jobs:
  benchmark:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.6.1

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build workspace
        run: pnpm build

      - name: Prepare AgentArena output directories
        run: mkdir -p ${normalizedOutputDir}

      - name: Doctor adapters
        run: ${doctorCommand}

      - name: Run benchmark
        run: node packages/cli/dist/index.js run --repo . --task ${normalizedTaskPath} --agents ${normalizedAgents} --output ${normalizedOutputDir} --json > ${normalizedOutputDir}/run.json

${publishSummaryStep}

      - name: Upload benchmark artifacts
        uses: actions/upload-artifact@v4
        with:
          name: agentarena-benchmark
          path: |
            ${normalizedOutputDir}/doctor.json
            ${normalizedOutputDir}/run.json
            ${normalizedOutputDir}/summary.json
            ${normalizedOutputDir}/summary.md
            ${normalizedOutputDir}/pr-comment.md
            ${normalizedOutputDir}/report.html
            ${normalizedOutputDir}/badge.json
`;
}
