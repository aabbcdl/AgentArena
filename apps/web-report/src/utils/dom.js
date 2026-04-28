/**
 * @fileoverview DOM 操作辅助工具
 * 封装常用 DOM 操作，减少样板代码
 */

/**
 * 创建 DOM 元素
 * @param {string} tag - 标签名
 * @param {Object} attrs - 属性对象
 * @param {...(Node|string)} children - 子元素或文本
 * @returns {HTMLElement} 创建的元素
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') {
      el.className = value;
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      const eventName = key.slice(2).toLowerCase();
      el.addEventListener(eventName, value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else {
      el.setAttribute(key, value);
    }
  }
  
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      el.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  }
  
  return el;
}

/**
 * 添加 CSS 类
 * @param {HTMLElement} el - 目标元素
 * @param {string} className - 类名
 */
export function addClass(el, className) {
  el.classList.add(className);
}

/**
 * 移除 CSS 类
 * @param {HTMLElement} el - 目标元素
 * @param {string} className - 类名
 */
export function removeClass(el, className) {
  el.classList.remove(className);
}

/**
 * 切换 CSS 类
 * @param {HTMLElement} el - 目标元素
 * @param {string} className - 类名
 * @param {boolean} [force] - 强制添加/移除
 */
export function toggleClass(el, className, force) {
  el.classList.toggle(className, force);
}

/**
 * 绑定事件
 * @param {HTMLElement} el - 目标元素
 * @param {string} event - 事件名
 * @param {EventListenerOrEventListenerObject} handler - 处理函数
 * @param {Object} [options] - 事件选项
 */
export function on(el, event, handler, options) {
  el.addEventListener(event, handler, options);
}

/**
 * 解绑事件
 * @param {HTMLElement} el - 目标元素
 * @param {string} event - 事件名
 * @param {EventListenerOrEventListenerObject} handler - 处理函数
 * @param {Object} [options] - 事件选项
 */
export function off(el, event, handler, options) {
  el.removeEventListener(event, handler, options);
}

/**
 * 批量设置属性
 * @param {HTMLElement} el - 目标元素
 * @param {Object} attrs - 属性对象
 */
export function setAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') {
      el.className = value;
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else {
      el.setAttribute(key, value);
    }
  }
}

/**
 * 清空元素内容
 * @param {HTMLElement} el - 目标元素
 */
export function clear(el) {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

/**
 * 查找最近的匹配选择器的祖先元素
 * @param {HTMLElement} el - 起始元素
 * @param {string} selector - CSS 选择器
 * @returns {HTMLElement|null} 匹配的元素或 null
 */
export function closest(el, selector) {
  return el.closest(selector);
}

/**
 * 创建 DocumentFragment
 * @param {...Node} children - 子节点
 * @returns {DocumentFragment}
 */
export function fragment(...children) {
  const frag = document.createDocumentFragment();
  for (const child of children) {
    if (child != null) {
      frag.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }
  return frag;
}
