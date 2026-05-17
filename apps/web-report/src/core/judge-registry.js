/**
 * @fileoverview Judge 注册表
 * 管理内置和自定义 Judge，支持运行时注册和持久化
 */

import { resultStore } from '../utils/storage.js';
import { JUDGE_REGISTERED, JUDGE_UNREGISTERED } from './events.js';
import { stateManager } from './state.js';

/**
 * Judge 注册表类
 */
class JudgeRegistry {
  constructor() {
    this.builtinJudges = new Map();
    this.customJudges = new Map();
    this.loaded = false;
    this._worker = null;
    this._messageId = 0;
    this._pendingMessages = new Map();
  }

  /**
   * 获取或创建 Web Worker（懒加载，复用）
   */
  _getWorker() {
    if (!this._worker) {
      const workerUrl = new URL('../judge-worker.js', import.meta.url);
      this._worker = new Worker(workerUrl);

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
   * 向 Worker 发送消息并等待响应
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
   * 通过 Worker 执行 Judge 评估
   */
  async _evaluateInWorker(judgeId, context) {
    const result = await this._sendToWorker('evaluate', { judgeId, context });

    if (result.type === 'evaluate_error') {
      throw new Error(result.error);
    }

    return result.payload;
  }

  /**
   * 初始化（从 IndexedDB 加载自定义 Judge）
   */
  async init() {
    if (this.loaded) return;

    try {
      const customJudgesData = await resultStore.getSetting('customJudges');
      if (customJudgesData && Array.isArray(customJudgesData)) {
        for (const judgeData of customJudgesData) {
          try {
            const code = `registerJudge({id:${JSON.stringify(judgeData.id)},name:${JSON.stringify(judgeData.name)},description:${JSON.stringify(judgeData.description || '')},version:${JSON.stringify(judgeData.version || '1.0.0')},evaluate:${judgeData.evaluate}});`;
            await this._loadFromCodeInternal(code, false);
          } catch (err) {
            console.warn(`加载自定义 Judge ${judgeData.id} 失败:`, err);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to load custom Judges from IndexedDB:', err);
    }

    this.loaded = true;
  }

  /**
   * 注册内置 Judge
   * @param {Object} judge - Judge 定义
   */
  registerBuiltin(judge) {
    this.builtinJudges.set(judge.id, judge);
  }

  /**
   * 注册自定义 Judge
   * @param {Object} judge - Judge 定义
   */
  register(judge) {
    this._registerInternal(judge, true);
    this._persistCustomJudges();
    stateManager.publish(JUDGE_REGISTERED, { judge });
  }

  /**
   * 内部注册方法
   * @param {Object} judge - Judge 定义
   * @param {boolean} isCustom - 是否为自定义
   */
  _registerInternal(judge, isCustom = false) {
    if (!judge.id || !judge.name || !judge.evaluate) {
      throw new Error('Judge 必须包含 id、name 和 evaluate 字段');
    }

    if (typeof judge.evaluate !== 'function') {
      throw new Error('Judge.evaluate 必须是函数');
    }

    const judgeDef = {
      id: judge.id,
      name: judge.name,
      description: judge.description || '',
      version: judge.version || '1.0.0',
      evaluate: judge.evaluate,
      evaluateSource: judge.evaluateSource || judge.evaluate.toString(),
      isCustom
    };

    if (isCustom) {
      this.customJudges.set(judge.id, judgeDef);
    } else {
      this.builtinJudges.set(judge.id, judgeDef);
    }
  }

  /**
   * 从代码字符串注册 Judge（通过 Web Worker 沙箱执行）
   * @param {string} code - Judge 代码字符串
   * @returns {Promise<Object|null>} 注册的 Judge
   */
  async loadFromCode(code) {
    return this._loadFromCodeInternal(code, true);
  }

  /**
   * 内部加载方法
   * @param {string} code - Judge 代码字符串
   * @param {boolean} publishEvent - 是否发布事件和持久化
   * @returns {Promise<Object|null>}
   */
  async _loadFromCodeInternal(code, publishEvent) {
    const result = await this._sendToWorker('load_code', { code });

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
   * 取消注册 Judge
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
   * 获取 Judge
   * @param {string} id - Judge ID
   * @returns {Object|undefined}
   */
  get(id) {
    return this.customJudges.get(id) || this.builtinJudges.get(id);
  }

  /**
   * 列出所有 Judge
   * @returns {Array}
   */
  list() {
    return [
      ...Array.from(this.builtinJudges.values()),
      ...Array.from(this.customJudges.values())
    ];
  }

  /**
   * 列出内置 Judge
   * @returns {Array}
   */
  listBuiltin() {
    return Array.from(this.builtinJudges.values());
  }

  /**
   * 列出自定义 Judge
   * @returns {Array}
   */
  listCustom() {
    return Array.from(this.customJudges.values());
  }

  /**
   * 执行 Judge 评估
   * @param {string} id - Judge ID
   * @param {Object} context - 评估上下文
   * @returns {Promise<Object>}
   */
  async evaluate(id, context) {
    const judge = this.get(id);
    if (!judge) {
      throw new Error(`Judge ${id} 不存在`);
    }

    const timeoutMs = 30000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Judge ${id} 评估超时（${timeoutMs}ms）`)), timeoutMs);
    });

    const evalPromise = Promise.resolve(judge.evaluate(context));

    return Promise.race([evalPromise, timeoutPromise]);
  }

  /**
   * 持久化自定义 Judge
   */
  async _persistCustomJudges() {
    try {
      const judgesData = Array.from(this.customJudges.values()).map(j => ({
        id: j.id,
        name: j.name,
        description: j.description,
        version: j.version,
        evaluate: j.evaluateSource
      }));

      await resultStore.saveSetting('customJudges', judgesData);
    } catch (err) {
      console.warn('持久化自定义 Judge 失败:', err);
    }
  }
}

// 全局实例
export const judgeRegistry = new JudgeRegistry();
