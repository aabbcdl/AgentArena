const judges = new Map();

const BLOCKED_APIS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'EventSource', 'indexedDB', 'caches', 'Worker',
  'BroadcastChannel', 'SharedArrayBuffer'
];

for (const api of BLOCKED_APIS) {
  try {
    Object.defineProperty(self, api, {
      value: undefined,
      configurable: false,
      writable: false
    });
  } catch {}
}

self.onmessage = async (e) => {
  const { type, id, payload } = e.data;

  switch (type) {
    case 'load_code': {
      try {
        const registeredJudgeIds = [];
        const registerJudge = (judge) => {
          if (!judge.id || !judge.name || typeof judge.evaluate !== 'function') {
            throw new Error('Judge must have id, name, and evaluate function');
          }
          judges.set(judge.id, {
            id: judge.id,
            name: judge.name,
            description: judge.description || '',
            version: judge.version || '1.0.0',
            evaluate: judge.evaluate
          });
          registeredJudgeIds.push(judge.id);
          return judge;
        };

        const fn = new Function('registerJudge', ...BLOCKED_APIS, payload.code);
        fn(registerJudge, ...BLOCKED_APIS.map(() => undefined));

        if (registeredJudgeIds.length > 0) {
          const results = registeredJudgeIds.map(judgeId => {
            const stored = judges.get(judgeId);
            return {
              id: stored.id,
              name: stored.name,
              description: stored.description,
              version: stored.version,
              evaluateSource: stored.evaluate.toString()
            };
          });
          self.postMessage({
            type: 'load_code_result',
            id,
            payload: { judges: results }
          });
        } else {
          self.postMessage({
            type: 'load_code_error',
            id,
            error: 'No judge was registered via registerJudge()'
          });
        }
      } catch (err) {
        self.postMessage({
          type: 'load_code_error',
          id,
          error: err.message
        });
      }
      break;
    }

    case 'evaluate': {
      try {
        const judge = judges.get(payload.judgeId);
        if (!judge) {
          throw new Error(`Judge ${payload.judgeId} not found in worker`);
        }
        const result = await judge.evaluate(payload.context);
        self.postMessage({
          type: 'evaluate_result',
          id,
          payload: result
        });
      } catch (err) {
        self.postMessage({
          type: 'evaluate_error',
          id,
          error: err.message
        });
      }
      break;
    }

    case 'unload': {
      judges.delete(payload.judgeId);
      self.postMessage({ type: 'unload_result', id });
      break;
    }

    case 'ping': {
      self.postMessage({ type: 'pong', id });
      break;
    }

    default: {
      self.postMessage({
        type: 'error',
        id,
        error: `Unknown message type: ${type}`
      });
    }
  }
};
