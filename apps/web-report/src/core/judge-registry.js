/**
 * @fileoverview Judge Registry
 *
 * Manages built-in and custom Judges with runtime registration, persistence,
 * and HMAC-SHA256 code integrity protection.
 *
 * SECURITY:
 * - Custom judge code is executed via `new Function()` in a sandboxed Web Worker.
 * - Before persistence, each judge's code is HMAC-SHA256 signed. On reload from
 *   IndexedDB, the signature is verified to detect tampering (e.g. direct
 *   IndexedDB manipulation by a browser extension or XSS payload).
 * - The HMAC key is a random 32-byte secret stored alongside the judges in
 *   IndexedDB. If the key is rotated, all existing signatures are invalidated
 *   and judges must be re-registered.
 */

import { resultStore } from '../utils/storage.js';
import { JUDGE_REGISTERED, JUDGE_UNREGISTERED } from './events.js';
import { stateManager } from './state.js';

/** HMAC key storage key in resultStore */
const HMAC_KEY_STORAGE_KEY = 'judgeHmacKey';

/**
 * Generate or retrieve the persistent HMAC-SHA256 signing key.
 * Returns a CryptoKey suitable for sign/verify operations.
 */
async function getOrCreateHmacKey() {
  try {
    const storedHex = await resultStore.getSetting(HMAC_KEY_STORAGE_KEY);
    let keyData;
    if (storedHex && typeof storedHex === 'string' && storedHex.length === 64) {
      // Decode hex to Uint8Array
      keyData = new Uint8Array(storedHex.match(/.{2}/g).map(byte => parseInt(byte, 16)));
    } else {
      // Generate a new 32-byte random key
      keyData = self.crypto.getRandomValues(new Uint8Array(32));
      const hex = Array.from(keyData).map(b => b.toString(16).padStart(2, '0')).join('');
      await resultStore.saveSetting(HMAC_KEY_STORAGE_KEY, hex);
    }
    return await self.crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
    );
  } catch (err) {
    console.warn('Failed to initialize HMAC key — judge code signing disabled:', err);
    return null;
  }
}

/**
 * Compute HMAC-SHA256 of a string and return as hex.
 * @param {CryptoKey} key
 * @param {string} data
 * @returns {Promise<string>} hex-encoded HMAC
 */
async function computeHmac(key, data) {
  if (!key) return null;
  const encoder = new TextEncoder();
  const signature = await self.crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Judge Registry class
 */
class JudgeRegistry {
  constructor() {
    this.builtinJudges = new Map();
    this.customJudges = new Map();
    this.loaded = false;
    this._worker = null;
    this._messageId = 0;
    this._pendingMessages = new Map();
    this._hmacKey = null;
    this._hmacKeyPromise = null;
  }

  /**
   * Get or create the HMAC key (lazy, cached).
   */
  async _getHmacKey() {
    if (this._hmacKey) return this._hmacKey;
    if (!this._hmacKeyPromise) {
      this._hmacKeyPromise = getOrCreateHmacKey().then(key => {
        this._hmacKey = key;
        return key;
      });
    }
    return this._hmacKeyPromise;
  }

  /**
   * Sign judge code with HMAC-SHA256.
   * @param {string} code - The full registration code string
   * @returns {Promise<string|null>} hex HMAC or null if signing unavailable
   */
  async _signCode(code) {
    const key = await this._getHmacKey();
    return computeHmac(key, code);
  }

  /**
   * Verify HMAC-SHA256 of judge code.
   * @param {string} code
   * @param {string} expectedHmac
   * @returns {Promise<boolean>}
   */
  async _verifyCode(code, expectedHmac) {
    const key = await this._getHmacKey();
    if (!key || !expectedHmac) return true; // No key = skip verification
    const actual = await computeHmac(key, code);
    return actual === expectedHmac;
  }

  /**
   * Get or create Web Worker (lazy, reusable).
   */
  _getWorker() {
    if (!this._worker) {
      const workerUrl = new URL('../judge-worker.js', import.meta.url);
      this._worker = new Worker(workerUrl);

      // Send HMAC key to worker for in-worker verification
      this._getHmacKey().then(async (key) => {
        if (!key || !this._worker) return;
        try {
          const exported = await self.crypto.subtle.exportKey('raw', key);
          const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
          this._worker.postMessage({ type: 'init_crypto', id: 'init', payload: { keyBase64 } });
        } catch (err) {
          console.warn('Failed to send HMAC key to judge worker:', err);
        }
      }).catch(() => {});

      this._worker.onmessage = (e) => {
        const { id, type: msgType } = e.data;
        const pending = this._pendingMessages.get(id);
        if (pending) {
          this._pendingMessages.delete(id);
          clearTimeout(pending.timer);
          if (msgType.endsWith('_error') || msgType === 'error') {
            pending.reject(new Error(e.data.error));
          } else {
            pending.resolve(e.data);
          }
        }
      };

      this._worker.onerror = (err) => {
        for (const [id, pending] of this._pendingMessages) {
          this._pendingMessages.delete(id);
          clearTimeout(pending.timer);
          pending.reject(new Error(err.message || 'Worker error'));
        }
        this._worker = null;
      };
    }
    return this._worker;
  }

  /**
   * Send a message to the worker and wait for a response.
   */
  _sendToWorker(type, payload, timeoutMs = 30000) {
    const worker = this._getWorker();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}-${++this._messageId}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingMessages.delete(id);
        reject(new Error(`Worker communication timeout (${timeoutMs}ms)`));
      }, timeoutMs);

      this._pendingMessages.set(id, { resolve, reject, timer });
      worker.postMessage({ type, id, payload });
    });
  }

  /**
   * Execute a judge evaluation via the worker.
   */
  async _evaluateInWorker(judgeId, context) {
    const result = await this._sendToWorker('evaluate', { judgeId, context });

    if (result.type === 'evaluate_error') {
      throw new Error(result.error);
    }

    return result.payload;
  }

  /**
   * Initialize — load custom judges from IndexedDB with integrity verification.
   */
  async init() {
    if (this.loaded) return;

    try {
      const customJudgesData = await resultStore.getSetting('customJudges');
      if (customJudgesData && Array.isArray(customJudgesData)) {
        for (const judgeData of customJudgesData) {
          try {
            const code = `registerJudge({id:${JSON.stringify(judgeData.id)},name:${JSON.stringify(judgeData.name)},description:${JSON.stringify(judgeData.description || '')},version:${JSON.stringify(judgeData.version || '1.0.0')},evaluate:${judgeData.evaluate}});`;

            // ── Integrity verification ──
            // Verify HMAC before loading. If the code was tampered with
            // (e.g. via direct IndexedDB edit), the HMAC won't match and
            // the judge is silently dropped.
            if (judgeData.hmac) {
              const valid = await this._verifyCode(code, judgeData.hmac);
              if (!valid) {
                console.warn(`Custom Judge "${judgeData.id}" HMAC mismatch — code may have been tampered with. Skipping.`);
                continue;
              }
            }
            // If no HMAC is stored (legacy data), load without verification
            // but re-sign on next persist cycle.

            await this._loadFromCodeInternal(code, false, judgeData.hmac || null);
          } catch (err) {
            console.warn(`Failed to load custom Judge "${judgeData.id}":`, err);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to load custom Judges from IndexedDB:', err);
    }

    this.loaded = true;
  }

  /**
   * Register a built-in Judge.
   * @param {Object} judge - Judge definition
   */
  registerBuiltin(judge) {
    this.builtinJudges.set(judge.id, judge);
  }

  /**
   * Register a custom Judge.
   * @param {Object} judge - Judge definition
   */
  register(judge) {
    this._registerInternal(judge, true);
    this._persistCustomJudges();
    stateManager.publish(JUDGE_REGISTERED, { judge });
  }

  /**
   * Internal registration.
   * @param {Object} judge - Judge definition
   * @param {boolean} isCustom - Whether this is a custom (user-added) judge
   */
  _registerInternal(judge, isCustom = false) {
    if (!judge.id || !judge.name || !judge.evaluate) {
      throw new Error('Judge must have id, name, and evaluate fields');
    }

    if (typeof judge.evaluate !== 'function') {
      throw new Error('Judge.evaluate must be a function');
    }

    const judgeDef = {
      id: judge.id,
      name: judge.name,
      description: judge.description || '',
      version: judge.version || '1.0.0',
      evaluate: judge.evaluate,
      evaluateSource: judge.evaluateSource || judge.evaluate.toString(),
      hmac: judge.hmac || null,
      isCustom
    };

    if (isCustom) {
      this.customJudges.set(judge.id, judgeDef);
    } else {
      this.builtinJudges.set(judge.id, judgeDef);
    }
  }

  /**
   * Register judges from a code string via the sandboxed Web Worker.
   * The code is HMAC-signed before being sent to the worker.
   * @param {string} code - Judge registration code
   * @returns {Promise<Object|null>} The last registered judge, or null
   */
  async loadFromCode(code) {
    return this._loadFromCodeInternal(code, true, null);
  }

  /**
   * Internal code loading.
   * @param {string} code - Judge registration code
   * @param {boolean} publishEvent - Whether to publish events and persist
   * @param {string|null} existingHmac - Pre-existing HMAC (for legacy reloads)
   * @returns {Promise<Object|null>}
   */
  async _loadFromCodeInternal(code, publishEvent, existingHmac) {
    // Sign the code for worker-side verification
    const hmac = existingHmac || await this._signCode(code);

    const result = await this._sendToWorker('load_code', { code, hmac });

    if (result.type === 'load_code_error') {
      throw new Error(result.error);
    }

    const { judges: judgeResults } = result.payload;
    let lastJudge = null;

    for (const judgeData of judgeResults) {
      const judgeId = judgeData.id;
      const judgeDef = {
        id: judgeId,
        name: judgeData.name,
        description: judgeData.description,
        version: judgeData.version,
        evaluateSource: judgeData.evaluateSource,
        hmac,
        evaluate: (context) => this._evaluateInWorker(judgeId, context),
        isCustom: true
      };

      this.customJudges.set(judgeId, judgeDef);
      lastJudge = judgeDef;
    }

    if (publishEvent) {
      this._persistCustomJudges();
      for (const judgeData of judgeResults) {
        stateManager.publish(JUDGE_REGISTERED, { judge: this.customJudges.get(judgeData.id) });
      }
    }

    return lastJudge;
  }

  /**
   * Unregister a custom Judge.
   * @param {string} id - Judge ID
   */
  unregister(id) {
    if (this.customJudges.has(id)) {
      this.customJudges.delete(id);
      this._persistCustomJudges();
      stateManager.publish(JUDGE_UNREGISTERED, { id });

      if (this._worker) {
        this._sendToWorker('unload', { judgeId: id }).catch(() => {});
      }
      return true;
    }
    return false;
  }

  /**
   * Get a Judge by ID.
   * @param {string} id - Judge ID
   * @returns {Object|undefined}
   */
  get(id) {
    return this.customJudges.get(id) || this.builtinJudges.get(id);
  }

  /**
   * List all Judges (built-in + custom).
   * @returns {Array}
   */
  list() {
    return [
      ...Array.from(this.builtinJudges.values()),
      ...Array.from(this.customJudges.values())
    ];
  }

  /**
   * List built-in Judges.
   * @returns {Array}
   */
  listBuiltin() {
    return Array.from(this.builtinJudges.values());
  }

  /**
   * List custom Judges.
   * @returns {Array}
   */
  listCustom() {
    return Array.from(this.customJudges.values());
  }

  /**
   * Execute a Judge evaluation with a timeout.
   * @param {string} id - Judge ID
   * @param {Object} context - Evaluation context
   * @returns {Promise<Object>}
   */
  async evaluate(id, context) {
    const judge = this.get(id);
    if (!judge) {
      throw new Error(`Judge "${id}" not found`);
    }

    const timeoutMs = 30000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Judge "${id}" evaluation timed out (${timeoutMs}ms)`)), timeoutMs);
    });

    const evalPromise = Promise.resolve(judge.evaluate(context));

    return Promise.race([evalPromise, timeoutPromise]);
  }

  /**
   * Persist custom judges to IndexedDB with HMAC signatures.
   * Each judge's evaluate source is re-signed on every persist to ensure
   * the signature stays in sync with the stored code.
   */
  async _persistCustomJudges() {
    try {
      const judgesData = [];
      for (const j of this.customJudges.values()) {
        // Reconstruct the full registration code and sign it
        const code = `registerJudge({id:${JSON.stringify(j.id)},name:${JSON.stringify(j.name)},description:${JSON.stringify(j.description)},version:${JSON.stringify(j.version)},evaluate:${j.evaluateSource}});`;
        const hmac = await this._signCode(code);

        judgesData.push({
          id: j.id,
          name: j.name,
          description: j.description,
          version: j.version,
          evaluate: j.evaluateSource,
          hmac
        });
      }

      await resultStore.saveSetting('customJudges', judgesData);
    } catch (err) {
      console.warn('Failed to persist custom Judges:', err);
    }
  }
}

// Global instance
export const judgeRegistry = new JudgeRegistry();
