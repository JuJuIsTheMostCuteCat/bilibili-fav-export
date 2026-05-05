(function attachYoutubePlatform(globalScope) {
  async function collectFromCurrentTab(tabId, options, logger) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content/youtube-content.js"]
    });

    const response = await chrome.tabs.sendMessage(tabId, {
      type: "YOUTUBE_COLLECT_VISIBLE_VIDEOS",
      options: {
        includeCaptions: options?.includeCaptions !== false
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "YouTube 当前页面解析失败");
    }

    const items = globalScope.FavExportNormalize.uniqueByUrlOrTitle(response.items || []);
    (response.errors || []).forEach((entry) => logger?.warn(entry.message, entry.detail || ""));
    logger?.info("YouTube 当前页面采集完成", { count: items.length });

    return {
      items,
      invalidItems: [],
      summary: {
        platformLabel: "YouTube",
        folderNames: ["YouTube 当前页面"],
        timeRangeText: "当前页面已加载内容",
        totalCount: items.length,
        successCount: items.length,
        invalidCount: 0,
        failedCount: logger?.entries.filter((entry) => entry.level === "error").length || 0,
        description: "YouTube 首版仅解析当前页面已加载的视频卡片；字幕为可获取时导出，不保证所有视频都有字幕。"
      }
    };
  }

  globalScope.FavExportYoutube = {
    collectFromCurrentTab
  };
})(globalThis);
