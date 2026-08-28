# @agentarena/cli

## 0.2.1

### Patch Changes

- Remove the private web-report workspace package from the published CLI dependency graph. The CLI ships the web report as bundled assets, so global npm installation no longer attempts to fetch an unpublished package.

## 0.2.0

### Minor Changes

- 9ad2745: Security hardening (timing-safe auth, strict sandbox), API route extraction, trace streaming query, and adapter diagnostic logging for concurrent execution reliability.

### Patch Changes

- Updated dependencies [9ad2745]
  - @agentarena/adapters@0.2.0
  - @agentarena/core@0.2.0
  - @agentarena/trace@0.2.0
  - @agentarena/runner@0.2.0
  - @agentarena/web-report@0.1.1
  - @agentarena/report@0.2.0
  - @agentarena/taskpacks@0.2.0
