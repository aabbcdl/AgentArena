const BASELINE_ENV_NAMES = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "COMSPEC",
  "WINDIR",
  "HOME",
  "USERPROFILE",
  "TMP",
  "TEMP",
  "LANG",
  "TERM",
  "PWD",
  "SHELL",
  "USER",
  "USERNAME",
  "LOGNAME",
  "NVM_DIR",
  "NVM_BIN",
  "npm_config_cache",
  "npm_config_prefix",
  "npm_config_user_agent",
  "npm_execpath",
  "npm_node_execpath",
  "INIT_CWD",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "GCM_INTERACTIVE",
  "EDITOR",
  "VISUAL",
  "BROWSER"
];

const BLOCKED_ENV_NAMES = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "NODE_OPTIONS",
  "NODE_PATH",
  "ELECTRON_RUN_AS_NODE",
]);

/**
 * Parse AGENTARENA_EXTRA_ENV: comma-separated list of additional env var names
 * to pass through to agent processes (added on top of the baseline allowlist
 * and the task pack's envAllowList).
 */
function getExtraEnvNames(): string[] {
  const raw = process.env.AGENTARENA_EXTRA_ENV;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function buildExecutionEnvironment(
  allowedNames: string[],
  overrides: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const extraNames = getExtraEnvNames();

  for (const name of [...BASELINE_ENV_NAMES, ...allowedNames, ...extraNames]) {
    if (BLOCKED_ENV_NAMES.has(name)) continue;
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }

  for (const [name, value] of Object.entries(overrides)) {
    if (BLOCKED_ENV_NAMES.has(name)) continue;
    env[name] = value;
  }

  return env;
}
