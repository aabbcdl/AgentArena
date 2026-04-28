/**
 * @fileoverview 全局事件常量定义
 * 所有自定义事件名集中在此文件，避免字符串硬编码导致的不一致
 */

// 状态变更事件
export const STATE_CHANGE = 'state:change';
export const RUN_LIST_UPDATED = 'run:list_updated';
export const RUN_LOADED = 'run:loaded';
export const RUN_DELETED = 'run:deleted';

// 路由事件
export const ROUTE_CHANGE = 'route:change';

// Trace 回放事件
export const TRACE_SEGMENT_LOADED = 'trace:segment_loaded';
export const TRACE_INDEX_READY = 'trace:index_ready';

// 滚动事件
export const SCROLL_REACH_BOTTOM = 'scroll:reach_bottom';

// 评分事件
export const SCORING_MODE_CHANGED = 'scoring:mode_changed';
export const SCORE_WEIGHTS_CHANGED = 'scoring:weights_changed';

// Judge 事件
export const JUDGE_REGISTERED = 'judge:registered';
export const JUDGE_UNREGISTERED = 'judge:unregistered';

// 设置事件
export const SETTINGS_SAVED = 'settings:saved';

// 数据导入/导出事件
export const DATA_IMPORTED = 'data:imported';
export const DATA_EXPORTED = 'data:exported';

// UI 事件
export const THEME_CHANGED = 'ui:theme_changed';
export const LANGUAGE_CHANGED = 'ui:language_changed';
export const SIDEBAR_TOGGLED = 'ui:sidebar_toggled';
