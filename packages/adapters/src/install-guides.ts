/**
 * Declarative install guides for every adapter AgentArena supports.
 *
 * Inspired by EchoBird's install/*.json pattern. Each guide declares:
 *   - How to detect the CLI (--version command, config file paths)
 *   - How to install it (per-platform commands)
 *   - First-run configuration steps
 *   - Identity guard (common confusions with similar tools)
 *
 * This data drives:
 *   1. The improved `detectInstalledAgents()` function (backend)
 *   2. The `/api/install-guides` API endpoint (server)
 *   3. The "Install" section in the web UI for uninstalled adapters
 */

// ─── Types ───

export interface InstallGuide {
  /** Adapter ID matching AgentAdapter.id */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Project homepage URL */
  homepage?: string;
  /** Documentation URL */
  docs?: string;
  /** GitHub repository URL */
  github?: string;

  /**
   * Detection configuration — how to determine if this agent is installed.
   */
  detection: {
    /**
     * CLI binary name(s) to look for on PATH.
     * On Windows, `.cmd` / `.bat` suffixes are tried automatically.
     * The first match wins.
     */
    binaryNames: string[];
    /**
     * Command to get the version. Output is parsed for a semver-like token.
     * If the command exits non-zero or produces no version, the agent is
     * considered NOT installed (even if `--help` succeeds).
     */
    versionCommand?: string[];
    /**
     * Config file paths to check (relative to $HOME).
     * If none of these exist, the agent is marked "unverified" even if the
     * CLI binary is found. This catches false positives where a similarly-
     * named binary is on PATH but the actual agent was never configured.
     */
    configFiles?: string[];
  };

  /**
   * Installation commands keyed by platform label.
   * The first entry per platform is the "recommended" method.
   */
  install: {
    windows?: Record<string, string>;
    macos?: Record<string, string>;
    linux?: Record<string, string>;
    all?: Record<string, string>;
  };

  /**
   * Important warnings to show in the UI (e.g. deprecated install methods,
   * common confusion with similarly-named packages).
   */
  warnings?: string[];

  /**
   * Post-install notes (e.g. "restart your terminal", "set API key").
   */
  postInstall?: string[];
}

// ─── Guide Definitions ───

export const INSTALL_GUIDES: InstallGuide[] = [
  {
    id: "codex",
    displayName: "Codex CLI (OpenAI)",
    homepage: "https://github.com/openai/codex",
    docs: "https://github.com/openai/codex#readme",
    github: "https://github.com/openai/codex",
    detection: {
      binaryNames: ["codex"],
      versionCommand: ["--version"],
      configFiles: [".codex/config.toml", ".codex/config.json"],
    },
    install: {
      all: {
        "npm (recommended)": "npm install -g @openai/codex@latest",
        "bun": "bun add -g @openai/codex",
      },
    },
    warnings: [
      "The npm package is exactly '@openai/codex'. Do NOT install 'codex' alone (wrong package).",
    ],
    postInstall: [
      "Run `codex --version` to verify installation.",
      "Set OPENAI_API_KEY environment variable or run `codex` to authenticate.",
    ],
  },
  {
    id: "claude-code",
    displayName: "Claude Code (CLI)",
    homepage: "https://claude.ai/code",
    docs: "https://code.claude.com/docs/en/setup",
    github: "https://github.com/anthropics/claude-code",
    detection: {
      binaryNames: ["claude"],
      versionCommand: ["--version"],
      configFiles: [".claude.json", ".claude/settings.json"],
    },
    install: {
      windows: {
        "PowerShell (recommended)": 'irm https://claude.ai/install.ps1 | iex',
        "winget": "winget install Anthropic.ClaudeCode",
      },
      macos: {
        "curl (recommended)": "curl -fsSL https://claude.ai/install.sh | bash",
        "brew": "brew install --cask claude-code",
      },
      linux: {
        "curl (recommended)": "curl -fsSL https://claude.ai/install.sh | bash",
      },
    },
    warnings: [
      "npm install is DEPRECATED. Use curl/PowerShell/brew/winget instead.",
    ],
    postInstall: [
      "Run `claude` to complete interactive first-time setup.",
      "For non-interactive use, create ~/.claude.json with {\"hasCompletedOnboarding\": true}",
      "and ~/.claude/settings.json with allowedTools.",
    ],
  },
  {
    id: "gemini-cli",
    displayName: "Gemini CLI (Google)",
    homepage: "https://github.com/google-gemini/gemini-cli",
    github: "https://github.com/google-gemini/gemini-cli",
    detection: {
      binaryNames: ["gemini"],
      versionCommand: ["--version"],
      configFiles: [".gemini/settings.json"],
    },
    install: {
      all: {
        "npm (recommended)": "npm install -g @google/gemini-cli",
      },
    },
    postInstall: [
      "Run `gemini --version` to verify.",
      "Set GEMINI_API_KEY or run `gemini` for interactive login.",
    ],
  },
  {
    id: "aider",
    displayName: "Aider (CLI)",
    homepage: "https://aider.chat/",
    docs: "https://aider.chat/docs/",
    github: "https://github.com/Aider-AI/aider",
    detection: {
      binaryNames: ["aider"],
      versionCommand: ["--version"],
      configFiles: [".aider.conf.yml"],
    },
    install: {
      all: {
        "pipx (recommended)": "python -m pip install --user pipx && pipx install aider-chat",
        "pip": "python -m pip install --user aider-chat",
      },
      macos: {
        "brew": "brew install aider",
      },
    },
    warnings: [
      "Aider requires Python 3.10–3.12. Verify with `python --version` first.",
    ],
    postInstall: [
      "Run `aider --version` to verify.",
      "Set OPENAI_API_KEY or ANTHROPIC_API_KEY, or configure ~/.aider.conf.yml.",
    ],
  },
  {
    id: "kilo-cli",
    displayName: "Kilo CLI",
    homepage: "https://github.com/Kilo-Org/kilo",
    github: "https://github.com/Kilo-Org/kilo",
    detection: {
      binaryNames: ["kilo"],
      versionCommand: ["--version"],
    },
    install: {
      all: {
        "npm (recommended)": "npm install -g @kilo-org/kilo@latest",
      },
    },
    postInstall: [
      "Run `kilo --version` to verify.",
    ],
  },
  {
    id: "opencode",
    displayName: "OpenCode (CLI)",
    homepage: "https://opencode.ai/",
    docs: "https://opencode.ai/docs",
    github: "https://github.com/anomalyco/opencode",
    detection: {
      binaryNames: ["opencode"],
      versionCommand: ["--version"],
    },
    install: {
      windows: {
        "scoop": "scoop install opencode",
        "npm": "npm i -g opencode-ai",
      },
      macos: {
        "curl (recommended)": "curl -fsSL https://opencode.ai/install | bash",
        "brew": "brew install anomalyco/tap/opencode",
        "npm": "npm i -g opencode-ai",
      },
      linux: {
        "curl (recommended)": "curl -fsSL https://opencode.ai/install | bash",
        "npm": "npm i -g opencode-ai",
      },
    },
    postInstall: [
      "Run `opencode --version` to verify.",
    ],
  },
  {
    id: "qwen-code",
    displayName: "Qwen Code (CLI)",
    homepage: "https://qwen.ai/qwencode",
    docs: "https://qwenlm.github.io/qwen-code-docs/en/users/overview/",
    github: "https://github.com/QwenLM/qwen-code",
    detection: {
      binaryNames: ["qwen"],
      versionCommand: ["--version"],
      configFiles: [".qwen/settings.json"],
    },
    install: {
      all: {
        "npm (recommended)": "npm install -g @qwen-code/qwen-code",
        "bun": "bun add -g @qwen-code/qwen-code",
      },
    },
    warnings: [
      "The npm package is exactly '@qwen-code/qwen-code'. The CLI binary is `qwen`, not `qwen-code`.",
    ],
    postInstall: [
      "Run `qwen --version` to verify.",
      "Configure model via ~/.qwen/settings.json or environment variables.",
    ],
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot CLI",
    homepage: "https://github.com/features/copilot",
    detection: {
      binaryNames: ["copilot"],
      versionCommand: ["--version"],
    },
    install: {
      all: {
        "npm": "npm install -g @githubnext/github-copilot-cli",
      },
    },
    postInstall: [
      "Authenticate via GitHub account.",
    ],
  },
  {
    id: "augment",
    displayName: "Augment Code (CLI)",
    homepage: "https://www.augmentcode.com/",
    detection: {
      binaryNames: ["augment-code", "augment"],
      versionCommand: ["--version"],
      configFiles: [".augment/config.json", ".augmentcode/config.json"],
    },
    install: {
      windows: {
        "winget": "winget install AugmentCode.AugmentCode",
        "See docs": "Visit https://www.augmentcode.com/ for download",
      },
      macos: {
        "brew": "brew install --cask augment-code",
        "See docs": "Visit https://www.augmentcode.com/ for download",
      },
      linux: {
        "See docs": "Visit https://www.augmentcode.com/ for download",
      },
    },
    warnings: [
      "Augment Code is a desktop IDE, not a CLI tool. The CLI mode may require the desktop app to be running.",
      "Make sure you have the Augment Code desktop app installed AND the CLI component enabled.",
    ],
    postInstall: [
      "Open the Augment Code desktop app and complete initial setup.",
      "Verify CLI with `augment-code --version` or `augment --version`.",
    ],
  },
];

// ─── Lookup helpers ───

const GUIDE_MAP = new Map<string, InstallGuide>(
  INSTALL_GUIDES.map((guide) => [guide.id, guide])
);

export function getInstallGuide(adapterId: string): InstallGuide | undefined {
  return GUIDE_MAP.get(adapterId);
}

export function listInstallGuides(): InstallGuide[] {
  return [...INSTALL_GUIDES];
}
