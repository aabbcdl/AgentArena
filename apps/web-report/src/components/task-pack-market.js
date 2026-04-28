/**
 * @fileoverview 任务包市场组件
 * 提供任务包浏览、搜索、导入功能
 */

import { h } from '../utils/dom.js';

// 任务包注册表 URL（GitHub raw）
const TASK_PACK_REGISTRY_URL = 'https://raw.githubusercontent.com/agentarena/agentarena/main/task-packs.json';

/**
 * 任务包市场类
 */
export class TaskPackMarket {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      registryUrl: options.registryUrl || TASK_PACK_REGISTRY_URL,
      onImport: options.onImport || (() => {}),
      ...options
    };
    this.packs = [];
    this.filteredPacks = [];
    this.searchQuery = '';
  }

  /**
   * 初始化并加载任务包列表
   */
  async init() {
    await this.loadRegistry();
    this.render();
  }

  /**
   * 加载任务包注册表
   */
  async loadRegistry() {
    try {
      const response = await fetch(this.options.registryUrl, {
        cache: 'no-cache'
      });
      
      if (!response.ok) {
        throw new Error(`加载失败: ${response.status}`);
      }
      
      this.packs = await response.json();
      this.filteredPacks = [...this.packs];
    } catch (err) {
      console.warn('加载任务包注册表失败:', err);
      this.packs = [];
      this.filteredPacks = [];
    }
  }

  /**
   * 搜索过滤
   * @param {string} query - 搜索关键词
   */
  filter(query) {
    this.searchQuery = query.toLowerCase().trim();
    
    if (!this.searchQuery) {
      this.filteredPacks = [...this.packs];
    } else {
      this.filteredPacks = this.packs.filter(pack => 
        pack.name.toLowerCase().includes(this.searchQuery) ||
        pack.description.toLowerCase().includes(this.searchQuery) ||
        pack.tags.some(tag => tag.toLowerCase().includes(this.searchQuery))
      );
    }
    
    this.renderList();
  }

  /**
   * 从 GitHub URL 导入任务包
   * @param {string} url - GitHub 仓库 URL
   */
  async importFromUrl(url) {
    try {
      // 转换 GitHub URL 为 raw content URL
      const rawUrl = this._convertToRawUrl(url);
      
      const response = await fetch(rawUrl);
      if (!response.ok) {
        throw new Error(`无法获取任务包: ${response.status}`);
      }
      
      const taskPack = await response.json();
      
      // 验证任务包格式
      if (!taskPack.id || !taskPack.tasks || !Array.isArray(taskPack.tasks)) {
        throw new Error('无效的任务包格式');
      }
      
      this.options.onImport(taskPack);
      return { success: true, pack: taskPack };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 将 GitHub URL 转换为 raw content URL
   * @param {string} url - GitHub URL
   * @returns {string} raw content URL
   */
  _convertToRawUrl(url) {
    // 处理 https://github.com/user/repo/blob/branch/path/to/file.json
    const blobMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/);
    if (blobMatch) {
      const [, user, repo, branch, path] = blobMatch;
      return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`;
    }
    
    // 处理 https://github.com/user/repo
    const repoMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/?$/);
    if (repoMatch) {
      const [, user, repo] = repoMatch;
      // 尝试获取默认的任务包文件
      return `https://raw.githubusercontent.com/${user}/${repo}/main/taskpack.json`;
    }
    
    return url;
  }

  /**
   * 渲染整个市场界面
   */
  render() {
    if (!this.container) return;
    
    this.container.innerHTML = '';
    
    // 标题
    const header = h('div', { className: 'market-header' },
      h('h3', { className: 'market-title' }, '任务包市场'),
      h('p', { className: 'market-description' }, '浏览和导入社区共享的任务包')
    );
    
    // 搜索栏
    const searchBox = h('div', { className: 'market-search' },
      h('input', {
        type: 'text',
        className: 'market-search-input',
        placeholder: '搜索任务包...',
        oninput: (e) => this.filter(e.target.value)
      }),
      h('button', {
        className: 'market-import-btn',
        onclick: () => this.showImportDialog()
      }, '导入 URL')
    );
    
    // 列表容器
    this.listContainer = h('div', { className: 'market-list' });
    
    this.container.appendChild(header);
    this.container.appendChild(searchBox);
    this.container.appendChild(this.listContainer);
    
    this.renderList();
  }

  /**
   * 渲染任务包列表
   */
  renderList() {
    if (!this.listContainer) return;
    
    this.listContainer.innerHTML = '';
    
    if (this.filteredPacks.length === 0) {
      this.listContainer.appendChild(
        h('div', { className: 'market-empty' },
          this.searchQuery 
            ? '未找到匹配的任务包'
            : '暂无任务包，点击"导入 URL"添加'
        )
      );
      return;
    }
    
    for (const pack of this.filteredPacks) {
      const card = this._createPackCard(pack);
      this.listContainer.appendChild(card);
    }
  }

  /**
   * 创建任务包卡片
   * @param {Object} pack - 任务包数据
   * @returns {HTMLElement}
   */
  _createPackCard(pack) {
    const tags = pack.tags?.map(tag => 
      h('span', { className: 'market-tag' }, tag)
    ) || [];
    
    return h('div', { className: 'market-card' },
      h('div', { className: 'market-card-header' },
        h('h4', { className: 'market-card-title' }, pack.name),
        h('span', { className: 'market-card-count' }, `${pack.taskCount || '?'} 任务`)
      ),
      h('p', { className: 'market-card-description' }, pack.description || ''),
      h('div', { className: 'market-card-tags' }, ...tags),
      h('div', { className: 'market-card-footer' },
        h('span', { className: 'market-card-author' }, `by ${pack.author || 'unknown'}`),
        h('button', {
          className: 'market-card-import',
          onclick: () => this.importFromUrl(pack.repo)
        }, '导入')
      )
    );
  }

  /**
   * 显示导入对话框
   */
  showImportDialog() {
    const dialog = h('div', { className: 'market-dialog-overlay' },
      h('div', { className: 'market-dialog' },
        h('h4', {}, '导入任务包'),
        h('p', { className: 'market-dialog-hint' }, '输入 GitHub 仓库 URL 或 raw content URL'),
        h('input', {
          type: 'text',
          className: 'market-dialog-input',
          placeholder: 'https://github.com/user/repo',
          id: 'market-import-url'
        }),
        h('div', { className: 'market-dialog-actions' },
          h('button', {
            className: 'market-dialog-cancel',
            onclick: () => dialog.remove()
          }, '取消'),
          h('button', {
            className: 'market-dialog-confirm',
            onclick: async () => {
              const input = dialog.querySelector('#market-import-url');
              const url = input.value.trim();
              if (!url) return;
              
              const result = await this.importFromUrl(url);
              if (result.success) {
                dialog.remove();
                alert(`任务包 "${result.pack.name}" 导入成功！`);
              } else {
                alert(`导入失败: ${result.error}`);
              }
            }
          }, '导入')
        )
      )
    );
    
    document.body.appendChild(dialog);
  }
}
