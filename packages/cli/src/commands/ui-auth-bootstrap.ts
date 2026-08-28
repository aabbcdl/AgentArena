import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const UI_AUTH_BOOTSTRAP_TTL_MS = 60_000;

export interface UiAuthBootstrap {
  code: string;
  exchange(code: string): string | null;
}

interface UiAuthBootstrapOptions {
  now?: () => number;
  ttlMs?: number;
  code?: string;
}

function digestBootstrapCode(code: string): Buffer {
  return createHash("sha256").update(code, "utf8").digest();
}

export function createUiAuthBootstrap(
  authToken: string,
  options: UiAuthBootstrapOptions = {}
): UiAuthBootstrap {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? UI_AUTH_BOOTSTRAP_TTL_MS;
  const code = options.code ?? randomBytes(32).toString("base64url");
  const expectedDigest = digestBootstrapCode(code);
  const expiresAt = now() + ttlMs;
  let consumed = false;

  return {
    code,
    exchange(candidate: string): string | null {
      if (consumed || now() > expiresAt) {
        consumed = true;
        return null;
      }

      const candidateDigest = digestBootstrapCode(candidate);
      if (!timingSafeEqual(expectedDigest, candidateDigest)) {
        return null;
      }

      consumed = true;
      return authToken;
    }
  };
}
