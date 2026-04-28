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
