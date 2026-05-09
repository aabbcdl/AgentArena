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

export function buildExecutionEnvironment(
  allowedNames: string[],
  overrides: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const name of [...BASELINE_ENV_NAMES, ...allowedNames]) {
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
