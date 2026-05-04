(function attachLogger(globalScope) {
  function createLogger() {
    const entries = [];

    function push(level, message, detail = "") {
      entries.push({
        time: globalScope.FavExportDate?.formatDateTime(new Date()) || new Date().toISOString(),
        level,
        message,
        detail: typeof detail === "string" ? detail : JSON.stringify(detail)
      });
    }

    return {
      info: (message, detail) => push("info", message, detail),
      warn: (message, detail) => push("warn", message, detail),
      error: (message, detail) => push("error", message, detail),
      entries
    };
  }

  globalScope.FavExportLogger = {
    createLogger
  };
})(globalThis);
