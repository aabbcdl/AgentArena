/**
 * @fileoverview 全局状态管理
 * 提供 Pub/Sub 事件总线，状态变更时自动触发视图更新
 */

import { STATE_CHANGE } from './events.js';

/**
 * 状态管理器类
 * 管理全局状态，支持订阅/发布模式
 */
class StateManager {
  constructor() {
    this.state = {};
    this.listeners = new Map();
  }

  /**
   * 获取单个状态值
   * @param {string} key - 状态键名
   * @returns {any} 状态值
   */
  get(key) {
    return this.state[key];
  }

  /**
   * 设置单个状态值
   * @param {string} key - 状态键名
   * @param {any} value - 状态值
   */
  set(key, value) {
    const oldValue = this.state[key];
    this.state[key] = value;
    this.publish(STATE_CHANGE, { key, value, oldValue });
  }

  /**
   * 获取完整状态对象
   * @returns {Object} 完整状态
   */
  getState() {
    return { ...this.state };
  }

  /**
   * 批量设置状态
   * @param {Object} partial - 部分状态对象
   */
  setState(partial) {
    const changed = [];
    for (const [key, value] of Object.entries(partial)) {
      const oldValue = this.state[key];
      this.state[key] = value;
      changed.push({ key, value, oldValue });
    }
    if (changed.length > 0) {
      this.publish(STATE_CHANGE, { changed });
    }
  }

  /**
   * 订阅事件
   * @param {string} event - 事件名
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  subscribe(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    
    // 返回取消订阅函数
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  /**
   * 取消订阅事件
   * @param {string} event - 事件名
   * @param {Function} callback - 回调函数
   */
  unsubscribe(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }

  /**
   * 发布事件
   * @param {string} event - 事件名
   * @param {any} data - 事件数据
   */
  publish(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(data);
        } catch (err) {
          console.error(`StateManager: 事件 ${event} 回调出错`, err);
        }
      }
    }
  }
}

// 全局状态管理器实例
export const stateManager = new StateManager();
