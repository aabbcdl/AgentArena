/**
 * @fileoverview Trace Worker
 * 在后台线程中处理 JSONL trace 文件的索引构建和分段解析
 * 支持 gzip 压缩解压、按字节偏移分段、JSONL 行边界处理
 */

/**
 * 检测是否为 gzip 数据
 * @param {ArrayBuffer} buffer
 * @returns {boolean}
 */
function isGzipped(buffer) {
  const bytes = new Uint8Array(buffer);
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * 解压 gzip 数据，优先使用 DecompressionStream，降级到 pako
 * @param {ArrayBuffer} compressed
 * @returns {Promise<string>}
 */
async function decompressGzip(compressed) {
  // 优先使用 DecompressionStream（现代浏览器支持）
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();

      writer.write(new Uint8Array(compressed));
      writer.close();

      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return new TextDecoder().decode(result);
    } catch {
      // DecompressionStream 失败，继续降级
    }
  }

  // 降级：尝试导入 pako
  try {
    // @ts-expect-error - optional dependency
    const pako = await import('pako');
    const bytes = new Uint8Array(compressed);
    return pako.ungzip(bytes, { to: 'string' });
  } catch {
    throw new Error('无法解压 gzip 数据：浏览器不支持 DecompressionStream，且 pako 未安装');
  }
}

/**
 * 将 ArrayBuffer / string 统一为文本
 * @param {ArrayBuffer|string} input
 * @returns {Promise<string>}
 */
async function ensureText(input) {
  if (typeof input === 'string') return input;
  if (input instanceof ArrayBuffer) {
    if (isGzipped(input)) {
      return decompressGzip(input);
    }
    return new TextDecoder().decode(input);
  }
  throw new Error('不支持的输入类型');
}

/**
 * 按字节偏移构建分段索引
 * 遍历文本找到换行符位置，按 SEGMENT_SIZE 行分段
 * @param {string} text - JSONL 全文
 * @returns {Object} 索引结构
 */
function buildIndex(text) {
  const SEGMENT_SIZE = 5000; // 每段约 5000 个事件
  const segments = [];
  const lineStarts = [0]; // 每行的起始字节偏移（UTF-16 code unit）

  // 先扫描所有换行符位置
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) { // '\n'
      lineStarts.push(i + 1);
    }
  }

  const totalLines = lineStarts.length;
  let eventCount = 0;
  let segStartLine = 0;

  for (let lineIdx = 0; lineIdx < totalLines; lineIdx++) {
    const lineStart = lineStarts[lineIdx];
    const lineEnd = lineIdx + 1 < totalLines ? lineStarts[lineIdx + 1] - 1 : text.length;
    const line = text.slice(lineStart, lineEnd).trim();

    if (line.length === 0) continue;

    eventCount++;

    if (eventCount >= SEGMENT_SIZE) {
      segments.push({
        startLine: segStartLine,
        endLine: lineIdx,
        startByte: lineStarts[segStartLine],
        endByte: lineIdx + 1 < totalLines ? lineStarts[lineIdx + 1] : text.length,
        eventCount
      });
      segStartLine = lineIdx + 1;
      eventCount = 0;
    }
  }

  // 处理最后一段
  if (eventCount > 0) {
    segments.push({
      startLine: segStartLine,
      endLine: totalLines - 1,
      startByte: lineStarts[segStartLine],
      endByte: text.length,
      eventCount
    });
  }

  return {
    totalEvents: segments.reduce((sum, s) => sum + s.eventCount, 0),
    totalLines,
    segments,
    lineStarts // 保留行偏移表，方便按时间查找时快速定位
  };
}

/**
 * 加载指定段的数据
 * @param {string} text - JSONL 全文
 * @param {Object} segment - 段信息
 * @returns {Array} 解析后的事件数组
 */
function loadSegment(text, segment) {
  const events = [];
  const { startByte, endByte } = segment;

  // 按字节偏移切片，处理行边界
  const chunk = text.slice(startByte, endByte);
  const lines = chunk.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed);
      events.push(event);
    } catch {
      // 跳过解析失败的行（可能是截断的 JSON）
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

// 当前加载的文本缓存和索引
let currentText = null;
let currentIndex = null;

/**
 * 处理消息
 */
self.onmessage = async (e) => {
  const { type, payload, id } = e.data;

  switch (type) {
    case 'build_index': {
      try {
        const text = await ensureText(payload.text || payload.buffer);
        currentText = text;
        currentIndex = buildIndex(text);

        self.postMessage({
          type: 'index_ready',
          id,
          payload: {
            totalEvents: currentIndex.totalEvents,
            totalLines: currentIndex.totalLines,
            segmentCount: currentIndex.segments.length
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
      // 取消当前操作
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
