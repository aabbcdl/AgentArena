import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { AgentRequestedConfig, AgentSelection, RepoSourceResolution } from "./types/index.js";

export function createRunId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

const MAX_REASONABLE_TIMEOUT_MS = 24 * 60 * 60 * 1_000; // 24 hours

export function resolveTimeoutMs(value: string | undefined, fallbackMs: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
  }
  // Cap at a reasonable maximum to prevent absurdly large timeouts
  return Math.min(parsed, MAX_REASONABLE_TIMEOUT_MS);
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "0ms";
  }

  if (durationMs < 1_000) {
    return `${Math.round(durationMs)}ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(2)}s`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = ((durationMs % 60_000) / 1_000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

export function getPlatformInfo(): { platform: string; arch: string; nodeVersion: string } {
  return {
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version
  };
}

const BUILTIN_PREFIX = "builtin://";

export function resolveRepoSource(
  repoSource: string | undefined,
  userRepoPath: string,
  builtinReposRoot: string
): RepoSourceResolution {
  if (!repoSource || repoSource === "user") {
    return { kind: "user", repoPath: userRepoPath };
  }

  if (repoSource.startsWith(BUILTIN_PREFIX)) {
    const name = repoSource.slice(BUILTIN_PREFIX.length).trim();
    if (!name || /[/\\]/.test(name) || name === ".." || name === ".") {
      throw new Error(
        `Invalid builtin repo name in repoSource: "${repoSource}". ` +
        `Expected format: "builtin://repo-name".`
      );
    }
    return { kind: "builtin", repoPath: path.join(builtinReposRoot, name) };
  }

  if (repoSource.startsWith("http://") || repoSource.startsWith("https://")) {
    const repoUrl = new URL(repoSource);
    const repoName = path.basename(repoUrl.pathname, path.extname(repoUrl.pathname)) || "repo";
    const safeName = repoName.replace(/[^a-zA-Z0-9._-]+/g, "_");
    return { kind: "url", repoPath: path.join(builtinReposRoot, safeName) };
  }

  throw new Error(
    `Unsupported repoSource: "${repoSource}". ` +
    `Supported values: "user", "builtin://repo-name", or an HTTP(S) URL.`
  );
}

export function validateTaskPackId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(id) || /^[a-z0-9]{1,64}$/.test(id);
}

function isPrivateIp(ip: string): boolean {
  if (ip === "0.0.0.0") return true;
  // Full 127.0.0.0/8 loopback range
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith("169.254.")) return true;
  // RFC 6598 Carrier-Grade NAT / shared address space
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
  // RFC 2544 benchmark testing
  if (/^198\.1[89]\./.test(ip)) return true;
  // Multicast
  if (/^(22[4-9]|23\d)\./.test(ip)) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  // IPv6 loopback
  if (ip === "::1") return true;
  // IPv6 ULA (fc00::/7)
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  // IPv6 link-local (fe80::/10)
  if (/^fe80:/i.test(ip)) return true;
  // IPv6 multicast (ff00::/8)
  if (/^ff00:/i.test(ip)) return true;
  // Unspecified
  if (ip === "::") return true;
  return false;
}

export function isInternalUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    let hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "::1" || hostname === "[::]" || hostname === "0.0.0.0") return true;
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      hostname = hostname.slice(1, -1);
    }
    if (isPrivateIpv6(hostname)) return true;
    const ipv4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
    const match = hostname.match(ipv4Mapped);
    if (match) {
      if (isPrivateIp(match[1])) return true;
    }
    const ipv4MappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
    const hexMatch = hostname.match(ipv4MappedHex);
    if (hexMatch) {
      const group1 = parseInt(hexMatch[1], 16);
      const group2 = parseInt(hexMatch[2], 16);
      const octets = [(group1 >>> 8) & 0xff, group1 & 0xff, (group2 >>> 8) & 0xff, group2 & 0xff];
      const ipv4 = octets.join(".");
      if (isPrivateIp(ipv4)) return true;
    }
    if (isPrivateIp(hostname)) return true;
    if (hostname.endsWith(".internal") || hostname.endsWith(".local") || hostname.endsWith(".localhost")) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Resolve a hostname to its IP addresses and check if any resolve to a
 * private/internal address. This guards against DNS rebinding attacks where
 * a domain initially resolves to a public IP (passing `isInternalUrl`)
 * but later resolves to a private IP at request time.
 *
 * Returns true if any resolved IP is internal/private.
 */
export async function hasInternalDnsResolution(urlString: string): Promise<boolean> {
  try {
    const { promises: dnsPromises } = await import("node:dns");
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();

    // Skip check for IP literals and known-safe hostnames
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return isPrivateIp(hostname);
    }

    try {
      const addresses = await dnsPromises.resolve4(hostname);
      for (const addr of addresses) {
        if (isPrivateIp(addr)) return true;
      }
    } catch {
      // No A records — try AAAA
    }

    try {
      const addresses6 = await dnsPromises.resolve6(hostname);
      for (const addr of addresses6) {
        if (isPrivateIpv6(addr)) return true;
      }
    } catch {
      // No AAAA records either — treat as non-internal
    }

    return false;
  } catch {
    // DNS resolution failure = treat as potentially internal (fail-safe)
    return true;
  }
}

function slugifyVariantPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createAgentSelection(input: {
  baseAgentId: string;
  displayLabel?: string;
  config?: AgentRequestedConfig;
  configSource?: "ui" | "cli";
}): AgentSelection {
  const config = input.config ?? {};
  const variantParts = [input.baseAgentId];
  if (config.providerProfileId) {
    variantParts.push(slugifyVariantPart(config.providerProfileId) || "profile");
  }
  if (config.model) {
    variantParts.push(slugifyVariantPart(config.model) || "model");
  }
  if (config.reasoningEffort) {
    variantParts.push(slugifyVariantPart(config.reasoningEffort) || "reasoning");
  }

  return {
    baseAgentId: input.baseAgentId,
    variantId: variantParts.join("-"),
    displayLabel: input.displayLabel ?? input.baseAgentId,
    config,
    configSource: input.configSource
  };
}
