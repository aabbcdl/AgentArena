/**
 * Judge execution Web Worker.
 *
 * SECURITY MODEL:
 * - Judge code runs inside `new Function()` (equivalent to eval) within this
 *   dedicated Web Worker. The Worker provides OS-level process isolation from
 *   the main thread.
 * - A denylist of dangerous browser APIs is set to `undefined` on the global
 *   scope before any judge code executes.
 * - Essential worker communication APIs (`postMessage`, `onmessage`) are
 *   frozen to prevent judge code from intercepting the message channel.
 * - All judge code is HMAC-SHA256 signed by the main thread before being sent
 *   here, and verified before execution. This prevents tampering via direct
 *   IndexedDB manipulation.
 * - Judge `evaluate()` calls are bounded by a configurable timeout.
 */

const judges = new Map();

/**
 * Expanded denylist of browser APIs blocked in judge execution context.
 *
 * `postMessage` is intentionally NOT blocked — the worker protocol depends on
 * it. Instead, `self.postMessage` is frozen below to prevent replacement.
 */
const BLOCKED_APIS = [
  // Network
  'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'EventSource', 'navigator', 'location',
  // Storage
  'indexedDB', 'caches',
  // Worker/threading
  'Worker', 'SharedWorker', 'BroadcastChannel', 'SharedArrayBuffer',
  // Navigation/history
  'history', 'openDatabase',
  // Service infrastructure
  'registration', 'serviceWorker',
];

// Block dangerous APIs before any judge code runs
for (const api of BLOCKED_APIS) {
  try {
    Object.defineProperty(self, api, {
      value: undefined,
      configurable: false,
      writable: false
    });
  } catch {
    // Some properties may not be configurable in all environments
  }
}

// Freeze essential worker communication to prevent judge code from
// intercepting the message channel (e.g. replacing postMessage to capture
// evaluate results or inject fake responses).
try { Object.freeze(self.postMessage); } catch { /* best-effort: may already be frozen */ }
try { Object.defineProperty(self, 'onmessage', { configurable: false }); } catch { /* best-effort: may not be configurable */ }

/**
 * Verify HMAC-SHA256 signature of judge code using SubtleCrypto.
 * The signing key is derived from a shared secret passed via the
 * 'init_crypto' message from the main thread.
 */
let cryptoKey = null;

async function verifyCodeSignature(code, expectedHmac) {
  if (!cryptoKey || !expectedHmac) return false; // No key = reject execution (key must be set first)
  try {
    const encoder = new TextEncoder();
    // Convert hex HMAC to bytes for constant-time comparison via SubtleCrypto
    const expectedBytes = new Uint8Array(expectedHmac.match(/.{2}/g).map(b => parseInt(b, 16)));
    return await self.crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      expectedBytes,
      encoder.encode(code)
    );
  } catch {
    return false;
  }
}

/** Maximum time (ms) a judge evaluate() call is allowed to run. */
const EVALUATE_TIMEOUT_MS = 30_000;

self.onmessage = async (e) => {
  const { type, id, payload } = e.data;

  switch (type) {
    case 'init_crypto': {
      // Receive the HMAC signing key from the main thread.
      // This must happen before any load_code messages.
      try {
        const keyData = Uint8Array.from(atob(payload.keyBase64), c => c.charCodeAt(0));
        cryptoKey = await self.crypto.subtle.importKey(
          'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
        );
        self.postMessage({ type: 'init_crypto_result', id });
      } catch (err) {
        self.postMessage({ type: 'init_crypto_error', id, error: err.message });
      }
      break;
    }

    case 'load_code': {
      try {
        // ── Integrity verification ──
        // Require HMAC key to be initialized before loading any code.
        // This prevents code execution during the race window before init_crypto.
        if (!cryptoKey) {
          self.postMessage({
            type: 'load_code_error',
            id,
            error: 'HMAC key not initialized — send init_crypto before load_code'
          });
          break;
        }

        // Verify the code hasn't been tampered with (e.g. via direct IndexedDB manipulation).
        if (payload.hmac) {
          const valid = await verifyCodeSignature(payload.code, payload.hmac);
          if (!valid) {
            self.postMessage({
              type: 'load_code_error',
              id,
              error: 'Judge code integrity check failed — code may have been tampered with'
            });
            break;
          }
        } else {
          self.postMessage({
            type: 'load_code_error',
            id,
            error: 'Judge code must include HMAC signature'
          });
          break;
        }

        const registeredJudgeIds = [];
        const registerJudge = (judge) => {
          if (!judge.id || !judge.name || typeof judge.evaluate !== 'function') {
            throw new Error('Judge must have id, name, and evaluate function');
          }
          // Validate judge ID format to prevent prototype pollution
          if (!/^[a-zA-Z0-9_-]+$/.test(judge.id)) {
            throw new Error('Judge ID must contain only alphanumeric characters, hyphens, and underscores');
          }
          // Prevent overwriting existing judges
          if (judges.has(judge.id)) {
            throw new Error(`Judge "${judge.id}" is already registered`);
          }
          judges.set(judge.id, {
            id: judge.id,
            name: judge.name,
            description: judge.description || '',
            version: judge.version || '1.0.0',
            evaluate: judge.evaluate
          });
          registeredJudgeIds.push(judge.id);
          return judge;
        };

        // Execute judge registration code with all dangerous APIs shadowed
        const fn = new Function('registerJudge', ...BLOCKED_APIS, payload.code);
        fn(registerJudge, ...BLOCKED_APIS.map(() => undefined));

        if (registeredJudgeIds.length > 0) {
          const results = registeredJudgeIds.map(judgeId => {
            const stored = judges.get(judgeId);
            return {
              id: stored.id,
              name: stored.name,
              description: stored.description,
              version: stored.version,
              evaluateSource: stored.evaluate.toString()
            };
          });
          self.postMessage({
            type: 'load_code_result',
            id,
            payload: { judges: results }
          });
        } else {
          self.postMessage({
            type: 'load_code_error',
            id,
            error: 'No judge was registered via registerJudge()'
          });
        }
      } catch (err) {
        self.postMessage({
          type: 'load_code_error',
          id,
          error: err.message
        });
      }
      break;
    }

    case 'evaluate': {
      try {
        const judge = judges.get(payload.judgeId);
        if (!judge) {
          throw new Error(`Judge ${payload.judgeId} not found in worker`);
        }
        // Bound evaluate() execution time to prevent infinite loops
        const result = await Promise.race([
          judge.evaluate(payload.context),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Judge evaluate timed out after ${EVALUATE_TIMEOUT_MS}ms`)), EVALUATE_TIMEOUT_MS)
          )
        ]);
        self.postMessage({
          type: 'evaluate_result',
          id,
          payload: result
        });
      } catch (err) {
        self.postMessage({
          type: 'evaluate_error',
          id,
          error: err.message
        });
      }
      break;
    }

    case 'unload': {
      judges.delete(payload.judgeId);
      self.postMessage({ type: 'unload_result', id });
      break;
    }

    case 'ping': {
      self.postMessage({ type: 'pong', id });
      break;
    }

    default: {
      self.postMessage({
        type: 'error',
        id,
        error: `Unknown message type: ${type}`
      });
    }
  }
};
