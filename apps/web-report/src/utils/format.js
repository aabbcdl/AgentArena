/**
 * @fileoverview 格式化工具
 * 提供时间、分数、文件大小等格式化函数
 */

/**
 * 格式化持续时间
 * @param {number} ms - 毫秒数
 * @returns {string} 格式化后的时间字符串
 */
export function formatDuration(ms) {
  if (ms == null || ms === 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * 格式化分数
 * @param {number} score - 分数（0-100）
 * @param {number} [decimals=1] - 小数位数
 * @returns {string} 格式化后的分数
 */
export function formatScore(score, decimals = 1) {
  if (score == null) return '-';
  return score.toFixed(decimals);
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的文件大小
 */
export function formatFileSize(bytes) {
  if (bytes == null || bytes === 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * 格式化日期
 * @param {string|number|Date} timestamp - 时间戳或日期对象
 * @returns {string} 格式化后的日期字符串
 */
export function formatDate(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '-';
  
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * 截断字符串
 * @param {string} str - 原始字符串
 * @param {number} maxLen - 最大长度
 * @param {string} [suffix='...'] - 截断后缀
 * @returns {string} 截断后的字符串
 */
export function truncate(str, maxLen, suffix = '...') {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - suffix.length) + suffix;
}

/**
 * 格式化数字（千分位）
 * @param {number} num - 数字
 * @returns {string} 格式化后的数字
 */
export function formatNumber(num) {
  if (num == null) return '-';
  return num.toLocaleString('zh-CN');
}

/**
 * 格式化百分比
 * @param {number} value - 小数（0-1）
 * @param {number} [decimals=1] - 小数位数
 * @returns {string} 百分比字符串
 */
export function formatPercent(value, decimals = 1) {
  if (value == null) return '-';
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * 格式化货币
 * @param {number} value - 金额
 * @param {string} [currency='USD'] - 货币类型
 * @returns {string} 格式化后的金额
 */
export function formatCurrency(value, currency = 'USD') {
  if (value == null) return '-';
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(value);
}
