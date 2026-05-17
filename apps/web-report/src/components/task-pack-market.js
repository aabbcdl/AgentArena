/**
 * @fileoverview Task Pack Market component
 * Provides task pack browsing, search, and import functionality
 */

import { translate } from '../i18n.js';
import { h } from '../utils/dom.js';

// Task pack registry URL (GitHub raw)
const TASK_PACK_REGISTRY_URL = 'https://raw.githubusercontent.com/agentarena/agentarena/main/task-packs.json';

/**
 * Task Pack Market class
 */
export class TaskPackMarket {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      registryUrl: options.registryUrl || TASK_PACK_REGISTRY_URL,
      onImport: options.onImport || (() => {}),
      language: options.language || 'en',
      ...options
    };
    this.packs = [];
    this.filteredPacks = [];
    this.searchQuery = '';
  }

  /** @param {string} key */
  t(key, ...args) {
    return translate(this.options.language, key, ...args);
  }

  /**
   * Initialize and load task pack list
   */
  async init() {
    await this.loadRegistry();
    this.render();
  }

  /**
   * Load task pack registry
   */
  async loadRegistry() {
    try {
      const response = await fetch(this.options.registryUrl, {
        cache: 'no-cache'
      });

      if (!response.ok) {
        throw new Error(this.t('marketLoadFailed', response.status));
      }

      this.packs = await response.json();
      this.filteredPacks = [...this.packs];
    } catch (err) {
      console.warn('Failed to load task pack registry:', err);
      this.packs = [];
      this.filteredPacks = [];
    }
  }

  /**
   * Search filter
   * @param {string} query - search keyword
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
   * Import task pack from GitHub URL
   * @param {string} url - GitHub repo URL
   */
  async importFromUrl(url) {
    try {
      const rawUrl = this._convertToRawUrl(url);

      const response = await fetch(rawUrl);
      if (!response.ok) {
        throw new Error(this.t('marketFetchFailed', response.status));
      }

      const taskPack = await response.json();

      if (!taskPack.id || !taskPack.tasks || !Array.isArray(taskPack.tasks)) {
        throw new Error(this.t('marketInvalidFormat'));
      }

      this.options.onImport(taskPack);
      return { success: true, pack: taskPack };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Convert GitHub URL to raw content URL
   * @param {string} url - GitHub URL
   * @returns {string} raw content URL
   */
  _convertToRawUrl(url) {
    const blobMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/);
    if (blobMatch) {
      const [, user, repo, branch, path] = blobMatch;
      return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`;
    }

    const repoMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/?$/);
    if (repoMatch) {
      const [, user, repo] = repoMatch;
      return `https://raw.githubusercontent.com/${user}/${repo}/main/taskpack.json`;
    }

    return url;
  }

  /**
   * Render the market UI
   */
  render() {
    if (!this.container) return;

    this.container.innerHTML = '';

    const header = h('div', { className: 'market-header' },
      h('h3', { className: 'market-title' }, this.t('marketTitle')),
      h('p', { className: 'market-description' }, this.t('marketDescription'))
    );

    const searchBox = h('div', { className: 'market-search' },
      h('input', {
        type: 'text',
        className: 'market-search-input',
        placeholder: this.t('marketSearchPlaceholder'),
        oninput: (e) => this.filter(e.target.value)
      }),
      h('button', {
        className: 'market-import-btn',
        onclick: () => this.showImportDialog()
      }, this.t('marketImportUrl'))
    );

    this.listContainer = h('div', { className: 'market-list' });

    this.container.appendChild(header);
    this.container.appendChild(searchBox);
    this.container.appendChild(this.listContainer);

    this.renderList();
  }

  /**
   * Render task pack list
   */
  renderList() {
    if (!this.listContainer) return;

    this.listContainer.innerHTML = '';

    if (this.filteredPacks.length === 0) {
      this.listContainer.appendChild(
        h('div', { className: 'market-empty' },
          this.searchQuery
            ? this.t('marketNoResults')
            : this.t('marketEmpty')
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
   * Create a task pack card
   * @param {Object} pack - task pack data
   * @returns {HTMLElement}
   */
  _createPackCard(pack) {
    const tags = pack.tags?.map(tag =>
      h('span', { className: 'market-tag' }, tag)
    ) || [];

    return h('div', { className: 'market-card' },
      h('div', { className: 'market-card-header' },
        h('h4', { className: 'market-card-title' }, pack.name),
        h('span', { className: 'market-card-count' }, this.t('marketTaskCount', pack.taskCount || '?'))
      ),
      h('p', { className: 'market-card-description' }, pack.description || ''),
      h('div', { className: 'market-card-tags' }, ...tags),
      h('div', { className: 'market-card-footer' },
        h('span', { className: 'market-card-author' }, `by ${pack.author || 'unknown'}`),
        h('button', {
          className: 'market-card-import',
          onclick: () => this.importFromUrl(pack.repo)
        }, this.t('marketImport'))
      )
    );
  }

  /**
   * Show import dialog
   */
  showImportDialog() {
    const dialog = h('div', { className: 'market-dialog-overlay', role: 'dialog', 'aria-modal': 'true' },
      h('div', { className: 'market-dialog' },
        h('h4', {}, this.t('marketDialogTitle')),
        h('p', { className: 'market-dialog-hint' }, this.t('marketDialogHint')),
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
          }, this.t('marketDialogCancel')),
          h('button', {
            className: 'market-dialog-confirm',
            onclick: async () => {
              const input = dialog.querySelector('#market-import-url');
              const url = input.value.trim();
              if (!url) return;

              const result = await this.importFromUrl(url);
              if (result.success) {
                dialog.remove();
                alert(this.t('marketImportSuccess', result.pack.name));
              } else {
                alert(this.t('marketImportFailed', result.error));
              }
            }
          }, this.t('marketDialogConfirm'))
        )
      )
    );

    document.body.appendChild(dialog);
  }
}
