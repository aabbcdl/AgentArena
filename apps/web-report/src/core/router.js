/**
 * @fileoverview 路由模块
 * 管理 URL 路径到视图函数的映射，支持参数路由
 */

import { ROUTE_CHANGE } from './events.js';
import { stateManager } from './state.js';

/**
 * 路由类
 * 处理路径匹配和视图切换
 */
class Router {
  constructor() {
    this.routes = new Map();
    this.currentPath = '';
    this.params = {};
    
    // 监听浏览器前进/后退
    window.addEventListener('popstate', () => {
      this._handleRouteChange();
    });
  }

  /**
   * 注册路由
   * @param {string} path - 路径模式（如 /run/:id）
   * @param {Function} viewFn - 视图渲染函数
   */
  register(path, viewFn) {
    // 将路径模式转换为正则表达式
    const pattern = path.replace(/:([^/]+)/g, '([^/]+)');
    const regex = new RegExp(`^${pattern}$`);
    const paramNames = [...path.matchAll(/:([^/]+)/g)].map(m => m[1]);
    
    this.routes.set(path, { regex, paramNames, viewFn });
  }

  /**
   * 导航到指定路径
   * @param {string} path - 目标路径
   */
  navigate(path) {
    if (path === this.currentPath) return;
    
    window.history.pushState({}, '', `#${path}`);
    this._handleRouteChange();
  }

  /**
   * 获取当前路径
   * @returns {string} 当前路径（不含 #）
   */
  getCurrentPath() {
    return window.location.hash.slice(1) || '/';
  }

  /**
   * 获取路由参数
   * @returns {Object} 参数对象
   */
  getParams() {
    return { ...this.params };
  }

  /**
   * 处理路由变更
   * @private
   */
  _handleRouteChange() {
    const path = this.getCurrentPath();
    this.currentPath = path;
    this.params = {};
    
    let matched = false;
    
    for (const [routePath, route] of this.routes) {
      const match = path.match(route.regex);
      if (match) {
        // 提取参数
        route.paramNames.forEach((name, index) => {
          this.params[name] = match[index + 1];
        });
        
        // 执行视图函数
        try {
          route.viewFn(this.params);
        } catch (err) {
          console.error(`Router: 视图渲染出错 (${routePath})`, err);
        }
        
        matched = true;
        break;
      }
    }
    
    if (!matched) {
      console.warn(`Router: 未匹配到路由 ${path}`);
    }
    
    stateManager.publish(ROUTE_CHANGE, { path, params: this.params });
  }

  /**
   * 启动路由（初始化时调用）
   */
  start() {
    this._handleRouteChange();
  }
}

// 全局路由实例
export const router = new Router();
