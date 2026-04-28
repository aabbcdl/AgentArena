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
            this._registerInternal(judgeData, true);
          } catch (err) {
            console.warn(`加载自定义 Judge ${judgeData.id} 失败:`, err);
          }
        }
      }
    } catch (err) {
      console.warn('从 IndexedDB 加载自定义 Judge 失败:', err);
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
    // 验证必要字段
    if (!judge.id || !judge.name || !judge.evaluate) {
      throw new Error('Judge 必须包含 id、name 和 evaluate 字段');
    }

    // 验证 evaluate 是函数
    if (typeof judge.evaluate !== 'function') {
      throw new Error('Judge.evaluate 必须是函数');
    }

    const judgeDef = {
      id: judge.id,
      name: judge.name,
      description: judge.description || '',
      version: judge.version || '1.0.0',
      evaluate: judge.evaluate,
      isCustom
    };

    if (isCustom) {
      this.customJudges.set(judge.id, judgeDef);
    } else {
      this.builtinJudges.set(judge.id, judgeDef);
    }
  }

  /**
   * 从代码字符串注册 Judge
   * @param {string} code - Judge 代码字符串
   * @returns {Promise<Object|null>} 注册的 Judge
   */
  async loadFromCode(code) {
    // 创建安全的执行环境
    const sandbox = {
      registerJudge: (judge) => {
        this.register(judge);
        return judge;
      }
    };

    // 使用 new Function 创建函数（有独立作用域）
    const fn = new Function('registerJudge', code);
    
    // 设置超时
    const timeoutMs = 30000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Judge 注册超时（${timeoutMs}ms）`)), timeoutMs);
    });

    const execPromise = new Promise((resolve, reject) => {
      try {
        fn(sandbox.registerJudge);
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    await Promise.race([execPromise, timeoutPromise]);
    
    // 返回最后注册的 Judge
    const judges = this.listCustom();
    return judges[judges.length - 1] || null;
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

    // 设置超时
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
        evaluate: j.evaluate.toString()
      }));
      
      await resultStore.saveSetting('customJudges', judgesData);
    } catch (err) {
      console.warn('持久化自定义 Judge 失败:', err);
    }
  }
}

// 全局实例
export const judgeRegistry = new JudgeRegistry();
