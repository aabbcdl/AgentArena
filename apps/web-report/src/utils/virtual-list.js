/**
 * @fileoverview 虚拟滚动列表组件
 * 固定行高虚拟滚动，仅渲染可视区 DOM，支持无障碍属性
 */

/**
 * @typedef {Object} VirtualListOptions
 * @property {number} itemHeight - 每项固定高度 (px)
 * @property {number} [overscan=5] - 可视区外额外渲染的行数
 * @property {string} [className='virtual-list'] - 容器 class
 * @property {string} [role='listbox'] - ARIA role
 */

/**
 * @typedef {Object} VirtualListInstance
 * @property {(items: any[], renderItem: (item: any, index: number) => Node | string) => void} setItems
 * @property {() => void} scrollToTop
 * @property {() => HTMLDivElement} getElement
 * @property {() => void} destroy
 */

/**
 * 创建虚拟滚动列表
 * @param {HTMLElement} container - 挂载容器
 * @param {VirtualListOptions} options - 配置项
 * @returns {VirtualListInstance}
 */
export function createVirtualList(container, options) {
  const {
    itemHeight,
    overscan = 5,
    className = 'virtual-list',
    role = 'listbox'
  } = options;

  /** @type {any[]} */
  let items = [];
  /** @type {(item: any, index: number) => Node | string} */
  let renderItem = () => '';
  /** @type {number | null} */
  let rafId = null;

  // 外层滚动容器
  const wrapper = document.createElement('div');
  wrapper.className = className;
  wrapper.style.cssText = 'overflow-y:auto;position:relative;will-change:transform;';
  wrapper.setAttribute('role', role);
  wrapper.setAttribute('tabindex', '0');

  // 内层高占位 div
  const spacer = document.createElement('div');
  spacer.style.cssText = 'position:relative;width:100%;';
  wrapper.appendChild(spacer);

  // 清空容器并挂载
  container.replaceChildren(wrapper);

  /**
   * 获取当前可视区范围
   * @returns {{ start: number, end: number }}
   */
  function getVisibleRange() {
    const scrollTop = wrapper.scrollTop;
    const viewportHeight = wrapper.clientHeight;
    const totalItems = items.length;

    if (totalItems === 0 || itemHeight <= 0) {
      return { start: 0, end: 0 };
    }

    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(viewportHeight / itemHeight);
    const end = Math.min(totalItems, start + visibleCount + overscan * 2);

    return { start, end };
  }

  /**
   * 渲染可视区 DOM
   */
  function render() {
    const totalItems = items.length;
    const totalHeight = totalItems * itemHeight;
    spacer.style.height = `${totalHeight}px`;

    if (totalItems === 0) {
      // 保留 spacer，清空子元素（除 spacer 外）
      while (wrapper.childNodes.length > 1) {
        wrapper.removeChild(wrapper.lastChild);
      }
      wrapper.setAttribute('aria-setsize', '0');
      return;
    }

    const { start, end } = getVisibleRange();

    wrapper.setAttribute('aria-setsize', String(totalItems));

    // 构建可视区 HTML
    const fragment = document.createDocumentFragment();

    for (let i = start; i < end; i++) {
      const itemEl = document.createElement('div');
      itemEl.style.cssText = `position:absolute;top:${i * itemHeight}px;left:0;right:0;height:${itemHeight}px;`;
      itemEl.setAttribute('role', 'option');
      itemEl.setAttribute('aria-posinset', String(i + 1));
      itemEl.setAttribute('aria-setsize', String(totalItems));
      const rendered = renderItem(items[i], i);
      if (rendered instanceof Node) {
        itemEl.replaceChildren(rendered);
      } else {
        itemEl.textContent = String(rendered);
      }
      fragment.appendChild(itemEl);
    }

    // 清除旧的渲染内容（保留 spacer）
    const toRemove = [];
    for (let j = 1; j < wrapper.childNodes.length; j++) {
      toRemove.push(wrapper.childNodes[j]);
    }
    for (const el of toRemove) {
      wrapper.removeChild(el);
    }

    wrapper.appendChild(fragment);
  }

  /**
   * scroll 事件用 requestAnimationFrame 节流
   */
  function onScroll() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      render();
    });
  }

  wrapper.addEventListener('scroll', onScroll, { passive: true });

  // 键盘导航支持
  wrapper.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      wrapper.scrollTop += itemHeight;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      wrapper.scrollTop -= itemHeight;
    } else if (e.key === 'Home') {
      e.preventDefault();
      wrapper.scrollTop = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      wrapper.scrollTop = items.length * itemHeight;
    }
  });

  // 监听容器尺寸变化
  const resizeObserver = new ResizeObserver(() => {
    render();
  });
  resizeObserver.observe(wrapper);

  return {
    /**
     * 设置数据并重新渲染
     * @param {any[]} newItems - 数据数组
     * @param {(item: any, index: number) => string} newRenderItem - 渲染函数
     */
    setItems(newItems, newRenderItem) {
      items = newItems;
      renderItem = newRenderItem;
      render();
    },

    /**
     * 滚动到顶部（搜索/过滤后重置）
     */
    scrollToTop() {
      wrapper.scrollTop = 0;
      render();
    },

    /**
     * 获取外层容器元素
     * @returns {HTMLDivElement}
     */
    getElement() {
      return wrapper;
    },

    /**
     * 销毁实例，清理事件监听
     */
    destroy() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      wrapper.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      container.replaceChildren();
    }
  };
}
