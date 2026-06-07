import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "./logging.js";
import { ensureDirectory } from "./snapshot.js";
import type { AdapterPreflightStatus } from "./types/agent.js";

export type HealthStatus = AdapterPreflightStatus;

export interface HealthCacheEntry {
  /** Adapter ID (e.g., "claude-code") */
  adapterId: string;
  /** Provider ID (e.g., "official", "mimo") */
  providerId: string;
  /** Endpoint or base URL (optional) */
  endpoint?: string;
  /** Cached health status */
  status: HealthStatus;
  /** Human-readable summary */
  summary: string;
  /** Structured failure reason (when blocked) */
  reason?: string;
  /** Suggested actions to resolve the issue */
  suggestedAction?: string[];
  /** Optional details array */
  details?: string[];
  /** Timestamp when this entry was created */
  timestamp: number;
  /** TTL in milliseconds */
  ttlMs: number;
}

export interface HealthCacheConfig {
  /** Directory to persist cache (default: .agentarena) */
  cacheDir?: string;
  /** Default TTL in milliseconds (default: 5 minutes) */
  defaultTtlMs?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1_000; // 5 minutes
const CACHE_FILENAME = "health-cache.json";

export class HealthCache {
  private entries = new Map<string, HealthCacheEntry>();
  private cachePath: string;
  private defaultTtlMs: number;
  private loaded = false;

  constructor(config?: HealthCacheConfig) {
    const cacheDir = config?.cacheDir ?? ".agentarena";
    this.cachePath = path.join(cacheDir, CACHE_FILENAME);
    this.defaultTtlMs = config?.defaultTtlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Generate a cache key from adapter, provider, and optional endpoint.
   */
  private getKey(adapterId: string, providerId: string, endpoint?: string): string {
    return endpoint ? `${adapterId}:${providerId}:${endpoint}` : `${adapterId}:${providerId}`;
  }

  /**
   * Load cache from disk. Called lazily on first access.
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const data = await fs.readFile(this.cachePath, "utf8");
      const entries = JSON.parse(data) as HealthCacheEntry[];
      for (const entry of entries) {
        const key = this.getKey(entry.adapterId, entry.providerId, entry.endpoint);
        this.entries.set(key, entry);
      }
    } catch {
      // Cache file doesn't exist or is invalid — start fresh
    }

    this.loaded = true;
  }

  /**
   * Persist cache to disk.
   */
  private async persist(): Promise<void> {
    try {
      await ensureDirectory(path.dirname(this.cachePath));
      const entries = Array.from(this.entries.values());
      await fs.writeFile(this.cachePath, JSON.stringify(entries, null, 2), "utf8");
    } catch (error) {
      // Non-fatal: log but don't throw
      logger.warn("core", "health_cache.persist_failed", `Failed to persist health cache: ${error instanceof Error ? error.message : String(error)}`, { error });
    }
  }

  /**
   * Check if a cache entry is still valid (not expired).
   */
  private isValid(entry: HealthCacheEntry): boolean {
    return Date.now() - entry.timestamp < entry.ttlMs;
  }

  /**
   * Get a cached health result. Returns undefined if not cached or expired.
   */
  async get(
    adapterId: string,
    providerId: string,
    endpoint?: string
  ): Promise<HealthCacheEntry | undefined> {
    await this.ensureLoaded();

    const key = this.getKey(adapterId, providerId, endpoint);
    const entry = this.entries.get(key);

    if (!entry) return undefined;

    if (!this.isValid(entry)) {
      this.entries.delete(key);
      return undefined;
    }

    return entry;
  }

  /**
   * Check if a valid cache entry exists for the given parameters.
   */
  async has(
    adapterId: string,
    providerId: string,
    endpoint?: string
  ): Promise<boolean> {
    const entry = await this.get(adapterId, providerId, endpoint);
    return entry !== undefined;
  }

  /**
   * Store a health check result in the cache.
   */
  async set(
    adapterId: string,
    providerId: string,
    status: HealthStatus,
    summary: string,
    options?: {
      endpoint?: string;
      reason?: string;
      suggestedAction?: string[];
      details?: string[];
      ttlMs?: number;
    }
  ): Promise<void> {
    await this.ensureLoaded();

    const key = this.getKey(adapterId, providerId, options?.endpoint);
    const entry: HealthCacheEntry = {
      adapterId,
      providerId,
      endpoint: options?.endpoint,
      status,
      summary,
      reason: options?.reason,
      suggestedAction: options?.suggestedAction,
      details: options?.details,
      timestamp: Date.now(),
      ttlMs: options?.ttlMs ?? this.defaultTtlMs,
    };

    this.entries.set(key, entry);
    await this.persist();
  }

  /**
   * Invalidate (remove) a specific cache entry.
   */
  async invalidate(
    adapterId: string,
    providerId: string,
    endpoint?: string
  ): Promise<void> {
    await this.ensureLoaded();

    const key = this.getKey(adapterId, providerId, endpoint);
    this.entries.delete(key);
    await this.persist();
  }

  /**
   * Clear all expired entries from the cache.
   */
  async cleanup(): Promise<number> {
    await this.ensureLoaded();

    let removed = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (!this.isValid(entry)) {
        this.entries.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      await this.persist();
    }

    return removed;
  }

  /**
   * Clear the entire cache.
   */
  async clear(): Promise<void> {
    this.entries.clear();
    await this.persist();
  }

  /**
   * Get all valid cache entries.
   */
  async getAll(): Promise<HealthCacheEntry[]> {
    await this.ensureLoaded();

    const validEntries: HealthCacheEntry[] = [];
    for (const entry of this.entries.values()) {
      if (this.isValid(entry)) {
        validEntries.push(entry);
      }
    }

    return validEntries;
  }

  /**
   * Get cache statistics.
   */
  async stats(): Promise<{
    total: number;
    valid: number;
    expired: number;
  }> {
    await this.ensureLoaded();

    let valid = 0;
    let expired = 0;

    for (const entry of this.entries.values()) {
      if (this.isValid(entry)) {
        valid++;
      } else {
        expired++;
      }
    }

    return {
      total: this.entries.size,
      valid,
      expired,
    };
  }
}

// Singleton instance for convenience
let defaultCache: HealthCache | null = null;

/**
 * Get or create the default HealthCache instance.
 */
export function getHealthCache(config?: HealthCacheConfig): HealthCache {
  if (!defaultCache) {
    defaultCache = new HealthCache(config);
  }
  return defaultCache;
}

/**
 * Reset the default cache instance (useful for testing).
 */
export function resetHealthCache(): void {
  defaultCache = null;
}
