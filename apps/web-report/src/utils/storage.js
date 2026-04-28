/**
 * @fileoverview IndexedDB 持久化封装
 * 提供 runs、traces、settings 的存储、查询、导出、导入功能
 */

const DB_NAME = 'agentarena';
const DB_VERSION = 1;

/**
 * ResultStore 类 - 封装 IndexedDB 操作
 */
class ResultStore {
  constructor() {
    this.db = null;
    this.ready = false;
  }

  /**
   * 初始化数据库
   * @returns {Promise<void>}
   */
  async init() {
    if (this.ready) return;
    
    return new Promise((resolve, _reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => {
        console.warn('IndexedDB 打开失败，将使用内存模式');
        this.ready = false;
        resolve();
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        this.ready = true;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
        
        // runs 表 - 存储运行元数据和评分结果
        if (!db.objectStoreNames.contains('runs')) {
          const runsStore = db.createObjectStore('runs', { keyPath: 'runId' });
          runsStore.createIndex('createdAt', 'createdAt', { unique: false });
          runsStore.createIndex('taskId', 'task.id', { unique: false });
        }
        
        // traces 表 - 存储 trace 原始数据（大文件单独存）
        if (!db.objectStoreNames.contains('traces')) {
          db.createObjectStore('traces', { keyPath: 'runId' });
        }
        
        // settings 表 - 存储用户偏好
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * 检查是否可用
   * @returns {boolean}
   */
  isAvailable() {
    return this.ready && this.db !== null;
  }

  /**
   * 获取事务
   * @param {string} storeName - 表名
   * @param {string} mode - 模式（readonly/readwrite）
   * @returns {IDBObjectStore|null}
   */
  _getStore(storeName, mode = 'readonly') {
    if (!this.isAvailable()) return null;
    const transaction = this.db.transaction([storeName], /** @type {IDBTransactionMode} */ (mode));
    return transaction.objectStore(storeName);
  }

  /**
   * 保存运行结果
   * @param {Object} run - 运行数据
   * @returns {Promise<boolean>}
   */
  async saveRun(run) {
    if (!this.isAvailable()) return false;
    
    return new Promise((resolve) => {
      const store = this._getStore('runs', 'readwrite');
      if (!store) { resolve(false); return; }
      
      const request = store.put(run);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  }

  /**
   * 获取运行列表（分页）
   * @param {{offset?: number, limit?: number}} [options] - 选项
   * @returns {Promise<Array>}
   */
  async listRuns(options = {}) {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    if (!this.isAvailable()) return [];
    
    return new Promise((resolve) => {
      const store = this._getStore('runs', 'readonly');
      if (!store) { resolve([]); return; }
      
      const runs = [];
      const request = store.index('createdAt').openCursor(null, 'prev');
      let skipped = 0;
      
      request.onsuccess = (event) => {
        const cursor = /** @type {IDBRequest} */ (event.target).result;
        if (!cursor) { resolve(runs); return; }
        
        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }
        
        if (runs.length < limit) {
          runs.push(cursor.value);
          cursor.continue();
        } else {
          resolve(runs);
        }
      };
      
      request.onerror = () => resolve([]);
    });
  }

  /**
   * 获取所有运行（不分页）
   * @returns {Promise<Array>}
   */
  async getAllRuns() {
    if (!this.isAvailable()) return [];
    
    return new Promise((resolve) => {
      const store = this._getStore('runs', 'readonly');
      if (!store) { resolve([]); return; }
      
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  /**
   * 获取单个运行
   * @param {string} runId - 运行 ID
   * @returns {Promise<Object|null>}
   */
  async getRun(runId) {
    if (!this.isAvailable()) return null;
    
    return new Promise((resolve) => {
      const store = this._getStore('runs', 'readonly');
      if (!store) { resolve(null); return; }
      
      const request = store.get(runId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  /**
   * 删除运行
   * @param {string} runId - 运行 ID
   * @returns {Promise<boolean>}
   */
  async deleteRun(runId) {
    if (!this.isAvailable()) return false;
    
    return new Promise((resolve) => {
      const store = this._getStore('runs', 'readwrite');
      if (!store) { resolve(false); return; }
      
      const request = store.delete(runId);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  }

  /**
   * 保存 trace 数据
   * @param {string} runId - 运行 ID
   * @param {Object} traceData - trace 数据
   * @returns {Promise<boolean>}
   */
  async saveTrace(runId, traceData) {
    if (!this.isAvailable()) return false;
    
    return new Promise((resolve) => {
      const store = this._getStore('traces', 'readwrite');
      if (!store) { resolve(false); return; }
      
      const request = store.put({ runId, data: traceData, savedAt: Date.now() });
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  }

  /**
   * 获取 trace 数据
   * @param {string} runId - 运行 ID
   * @returns {Promise<Object|null>}
   */
  async getTrace(runId) {
    if (!this.isAvailable()) return null;
    
    return new Promise((resolve) => {
      const store = this._getStore('traces', 'readonly');
      if (!store) { resolve(null); return; }
      
      const request = store.get(runId);
      request.onsuccess = () => resolve(request.result?.data || null);
      request.onerror = () => resolve(null);
    });
  }

  /**
   * 保存设置
   * @param {string} key - 键名
   * @param {any} value - 值
   * @returns {Promise<boolean>}
   */
  async saveSetting(key, value) {
    if (!this.isAvailable()) return false;
    
    return new Promise((resolve) => {
      const store = this._getStore('settings', 'readwrite');
      if (!store) { resolve(false); return; }
      
      const request = store.put({ key, value, updatedAt: Date.now() });
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  }

  /**
   * 获取设置
   * @param {string} key - 键名
   * @returns {Promise<any>}
   */
  async getSetting(key) {
    if (!this.isAvailable()) return null;
    
    return new Promise((resolve) => {
      const store = this._getStore('settings', 'readonly');
      if (!store) { resolve(null); return; }
      
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => resolve(null);
    });
  }

  /**
   * 导出数据
   * @param {Object} options - 选项
   * @param {Array<string>} [options.runIds] - 指定导出的运行 ID（不指定则导出全部）
   * @param {boolean} [options.compress=false] - 是否压缩
   * @returns {Promise<Blob>}
   */
  async export({ runIds, compress = false } = {}) {
    const runs = runIds 
      ? await Promise.all(runIds.map(id => this.getRun(id)))
      : await this.getAllRuns();
    
    const validRuns = runs.filter(Boolean);
    
    // 获取对应的 traces
    const traces = {};
    for (const run of validRuns) {
      const trace = await this.getTrace(run.runId);
      if (trace) traces[run.runId] = trace;
    }
    
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      runs: validRuns,
      traces: Object.keys(traces).length > 0 ? traces : undefined
    };
    
    const json = JSON.stringify(payload, null, 2);
    
    if (compress && typeof CompressionStream !== 'undefined') {
      const blob = new Blob([json], { type: 'application/json' });
      const compressed = await new Response(
        blob.stream().pipeThrough(new CompressionStream('gzip'))
      ).blob();
      return compressed;
    }
    
    return new Blob([json], { type: 'application/json' });
  }

  /**
   * 导入数据
   * @param {File|Blob} file - 文件对象
   * @returns {Promise<{success: boolean, count: number, error?: string}>}
   */
  async import(file) {
    try {
      let text;
      
      // 尝试解压 gzip
      if (file.type === 'application/gzip' || /** @type {File} */ (file).name?.endsWith('.gz')) {
        if (typeof DecompressionStream !== 'undefined') {
          const decompressed = await new Response(
            file.stream().pipeThrough(new DecompressionStream('gzip'))
          ).blob();
          text = await decompressed.text();
        } else {
          return { success: false, count: 0, error: '浏览器不支持解压，请使用未压缩的 JSON 文件' };
        }
      } else {
        text = await file.text();
      }
      
      const payload = JSON.parse(text);
      
      if (!payload.runs || !Array.isArray(payload.runs)) {
        return { success: false, count: 0, error: '无效的文件格式：缺少 runs 数据' };
      }
      
      let count = 0;
      for (const run of payload.runs) {
        if (run.runId) {
          await this.saveRun(run);
          count++;
        }
      }
      
      // 导入 traces
      if (payload.traces) {
        for (const [runId, traceData] of Object.entries(payload.traces)) {
          await this.saveTrace(runId, traceData);
        }
      }
      
      return { success: true, count };
    } catch (err) {
      return { success: false, count: 0, error: err.message };
    }
  }

  /**
   * 清空所有数据
   * @returns {Promise<boolean>}
   */
  async clearAll() {
    if (!this.isAvailable()) return false;
    
    return new Promise((resolve) => {
      const stores = ['runs', 'traces', 'settings'];
      let completed = 0;
      let hasError = false;
      
      for (const storeName of stores) {
        const store = this._getStore(storeName, 'readwrite');
        if (!store) { hasError = true; continue; }
        
        const request = store.clear();
        request.onsuccess = () => {
          completed++;
          if (completed === stores.length) resolve(!hasError);
        };
        request.onerror = () => {
          hasError = true;
          completed++;
          if (completed === stores.length) resolve(false);
        };
      }
    });
  }
}

// 全局实例
export const resultStore = new ResultStore();
