(function attachDateUtils(globalScope) {
  const pad = (value) => String(value).padStart(2, "0");

  function formatDateTime(input) {
    if (!input) return "";

    const date =
      input instanceof Date
        ? input
        : typeof input === "number"
          ? new Date(input < 10000000000 ? input * 1000 : input)
          : new Date(input);

    if (Number.isNaN(date.getTime())) return "";

    return [
      date.getFullYear(),
      "-",
      pad(date.getMonth() + 1),
      "-",
      pad(date.getDate()),
      " ",
      pad(date.getHours()),
      ":",
      pad(date.getMinutes()),
      ":",
      pad(date.getSeconds())
    ].join("");
  }

  function formatDateForFile(input = new Date()) {
    const date = input instanceof Date ? input : new Date(input);
    return [
      date.getFullYear(),
      "-",
      pad(date.getMonth() + 1),
      "-",
      pad(date.getDate())
    ].join("");
  }

  function resolveTimeRange(filter) {
    const now = new Date();
    const value = filter?.type || "all";

    if (value === "last7") {
      return { start: new Date(now.getTime() - 7 * 86400000), end: now };
    }

    if (value === "last30") {
      return { start: new Date(now.getTime() - 30 * 86400000), end: now };
    }

    if (value === "last180") {
      return { start: new Date(now.getTime() - 180 * 86400000), end: now };
    }

    if (value === "last365") {
      return { start: new Date(now.getTime() - 365 * 86400000), end: now };
    }

    if (value === "custom") {
      return {
        start: filter.startDate ? new Date(`${filter.startDate}T00:00:00`) : null,
        end: filter.endDate ? new Date(`${filter.endDate}T23:59:59`) : null
      };
    }

    return { start: null, end: null };
  }

  function isWithinTimeRange(dateTimeText, filter) {
    if (!dateTimeText) return true;

    const date = new Date(dateTimeText.replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return true;

    const range = resolveTimeRange(filter);
    if (range.start && date < range.start) return false;
    if (range.end && date > range.end) return false;
    return true;
  }

  globalScope.FavExportDate = {
    formatDateTime,
    formatDateForFile,
    isWithinTimeRange,
    resolveTimeRange
  };
})(globalThis);
