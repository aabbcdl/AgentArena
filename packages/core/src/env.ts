const BASELINE_ENV_NAMES = [
  // Path and system
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
  // Locale and terminal
  "LANG",
  "TERM",
  "PWD",
  "SHELL",
  "USER",
  "USERNAME",
  "LOGNAME",
  // Node.js runtime
  "NODE_PATH",
  "NODE_OPTIONS",
  "NVM_DIR",
  "NVM_BIN",
  // npm/pnpm/yarn
  "npm_config_cache",
  "npm_config_prefix",
  "npm_config_user_agent",
  "npm_execpath",
  "npm_node_execpath",
  "INIT_CWD",
  // SSL/TLS certificates
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  // Git operations
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "GCM_INTERACTIVE",
  // Editor/credential helpers
  "EDITOR",
  "VISUAL",
  "BROWSER"
];

// Environment variable names that may contain sensitive values and should be
// masked in logs. This is a subset of BASELINE_ENV_NAMES that could leak
// credentials, tokens, or other secrets if logged verbatim.
const SENSITIVE_ENV_NAMES = new Set([
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "GCM_INTERACTIVE",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "npm_config_prefix",
  "NVM_DIR",
  "NVM_BIN"
]);

const MASK_REPLACEMENT = "***";

/**
 * Returns a sanitized copy of the environment object where values for
 * sensitive keys are replaced with `***`. Use this when logging the
 * execution environment to avoid leaking secrets.
 */
export function sanitizeEnvironmentForLog(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    sanitized[key] = SENSITIVE_ENV_NAMES.has(key) ? MASK_REPLACEMENT : value;
  }
  return sanitized;
}

export function buildExecutionEnvironment(
  allowedNames: string[],
  overrides: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const name of [...BASELINE_ENV_NAMES, ...allowedNames]) {
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }

  for (const [name, value] of Object.entries(overrides)) {
    env[name] = value;
  }

  return env;
}
