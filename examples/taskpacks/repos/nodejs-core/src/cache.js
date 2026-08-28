function createCache(options = {}) {
  if (options.ttlMs !== undefined && (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0)) {
    throw new TypeError("ttlMs must be a positive number");
  }
  const ttlMs = options.ttlMs ?? 1000;
  const store = new Map();

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt >= ttlMs) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  return {
    get,
    set(key, value) { store.set(key, { value, createdAt: Date.now() }); },
    delete(key) { store.delete(key); },
    clear() { store.clear(); },
    size() { return store.size; }
  };
}

module.exports = { createCache };
