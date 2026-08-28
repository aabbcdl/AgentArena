const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

function formatLine(level, scope, context, message) {
  const contextText = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : "";
  return `[${level.toUpperCase()}] ${scope}${contextText} ${message}`;
}

function createLogger(scope, options = {}) {
  const minimum = LEVELS[options.level ?? "info"] ?? LEVELS.info;
  const baseContext = { ...(options.context ?? {}) };
  const sink = options.sink ?? console.log;
  const write = (level, message, extraContext = {}) => {
    if (LEVELS[level] < minimum) return;
    sink(formatLine(level, scope, { ...baseContext, ...extraContext }, message));
  };

  return {
    debug(message, context) { write("debug", message, context); },
    info(message, context) { write("info", message, context); },
    warn(message, context) { write("warn", message, context); },
    error(message, context) { write("error", message, context); },
    child(context) { return createLogger(scope, { level: Object.keys(LEVELS).find((key) => LEVELS[key] === minimum), context: { ...baseContext, ...context }, sink }); }
  };
}

module.exports = { LEVELS, createLogger };
