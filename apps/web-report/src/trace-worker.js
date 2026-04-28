/**
 * @fileoverview Trace Worker
 * 在后台线程中处理 JSONL trace 文件的索引构建和分段解析
 */

/**
 * 构建 trace 索引
 * @param {string} text - trace 文件全文
 * @returns {Object} 索引结构
 */
function buildIndex(text) {
  const lines = text.split('\n');
  const segments = [];
  const SEGMENT_SIZE = 5000; // 每段约 5000 个事件
  
  let currentSegment = { startLine: 0, endLine: 0, eventCount: 0, startByte: 0, endByte: 0 };
  let byteOffset = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const lineBytes = new TextEncoder().encode(line + '\n').length;
    
    if (currentSegment.eventCount >= SEGMENT_SIZE) {
      currentSegment.endLine = i - 1;
      currentSegment.endByte = byteOffset;
      segments.push({ ...currentSegment });
      
      currentSegment = {
        startLine: i,
        endLine: i,
        eventCount: 0,
        startByte: byteOffset,
        endByte: byteOffset
      };
    }
    
    currentSegment.eventCount++;
    currentSegment.endLine = i;
    byteOffset += lineBytes;
  }
  
  // 添加最后一段
  if (currentSegment.eventCount > 0) {
    currentSegment.endByte = byteOffset;
    segments.push(currentSegment);
  }
  
  return {
    totalEvents: segments.reduce((sum, s) => sum + s.eventCount, 0),
    totalLines: lines.length,
    segments
  };
}

/**
 * 加载指定段的数据
 * @param {string} text - trace 文件全文
 * @param {Object} segment - 段信息
 * @returns {Array} 解析后的事件数组
 */
function loadSegment(text, segment) {
  const lines = text.split('\n');
  const events = [];
  
  for (let i = segment.startLine; i <= segment.endLine && i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    try {
      const event = JSON.parse(line);
      events.push(event);
    } catch {
      // 跳过解析失败的行
    }
  }
  
  return events;
}

/**
 * 按时间范围过滤事件
 * @param {Array} events - 事件数组
 * @param {number} startTime - 开始时间
 * @param {number} endTime - 结束时间
 * @returns {Array} 过滤后的事件
 */
function filterByTimeRange(events, startTime, endTime) {
  return events.filter(event => {
    const time = event.timestamp || event.time || event.ts || 0;
    return time >= startTime && time <= endTime;
  });
}

/**
 * 按类型过滤事件
 * @param {Array} events - 事件数组
 * @param {Array<string>} types - 类型列表
 * @returns {Array} 过滤后的事件
 */
function filterByTypes(events, types) {
  if (!types || types.length === 0) return events;
  return events.filter(event => types.includes(event.type));
}

// 当前加载的文本缓存
let currentText = null;
let currentIndex = null;

/**
 * 处理消息
 */
self.onmessage = (e) => {
  const { type, payload, id } = e.data;
  
  switch (type) {
    case 'build_index': {
      try {
        currentText = payload.text;
        currentIndex = buildIndex(payload.text);
        
        self.postMessage({
          type: 'index_ready',
          id,
          payload: currentIndex
        });
      } catch (err) {
        self.postMessage({
          type: 'error',
          id,
          error: err.message
        });
      }
      break;
    }
    
    case 'load_segment': {
      try {
        if (!currentText || !currentIndex) {
          throw new Error('索引未构建，请先调用 build_index');
        }
        
        const segment = currentIndex.segments[payload.segmentIndex];
        if (!segment) {
          throw new Error(`段索引 ${payload.segmentIndex} 不存在`);
        }
        
        let events = loadSegment(currentText, segment);
        
        // 应用时间范围过滤
        if (payload.timeRange) {
          events = filterByTimeRange(events, payload.timeRange[0], payload.timeRange[1]);
        }
        
        // 应用类型过滤
        if (payload.types) {
          events = filterByTypes(events, payload.types);
        }
        
        self.postMessage({
          type: 'segment_data',
          id,
          payload: {
            segmentIndex: payload.segmentIndex,
            events,
            totalEvents: events.length
          }
        });
      } catch (err) {
        self.postMessage({
          type: 'error',
          id,
          error: err.message
        });
      }
      break;
    }
    
    case 'load_time_range': {
      try {
        if (!currentText || !currentIndex) {
          throw new Error('索引未构建，请先调用 build_index');
        }
        
        // 找到覆盖该时间范围的所有段
        const events = [];
        for (let i = 0; i < currentIndex.segments.length; i++) {
          const segment = currentIndex.segments[i];
          const segmentEvents = loadSegment(currentText, segment);
          const filtered = filterByTimeRange(segmentEvents, payload.startTime, payload.endTime);
          events.push(...filtered);
        }
        
        self.postMessage({
          type: 'range_data',
          id,
          payload: {
            events,
            totalEvents: events.length,
            startTime: payload.startTime,
            endTime: payload.endTime
          }
        });
      } catch (err) {
        self.postMessage({
          type: 'error',
          id,
          error: err.message
        });
      }
      break;
    }
    
    case 'cancel': {
      // 取消当前操作（简单实现：清空缓存）
      currentText = null;
      currentIndex = null;
      
      self.postMessage({
        type: 'cancelled',
        id
      });
      break;
    }
    
    default: {
      self.postMessage({
        type: 'error',
        id,
        error: `未知的消息类型: ${type}`
      });
    }
  }
};
