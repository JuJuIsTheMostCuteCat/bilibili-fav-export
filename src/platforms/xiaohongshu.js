(function attachXiaohongshuPlatform(globalScope) {
  async function collectFromCurrentTab(tabId, logger) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content/xiaohongshu-content.js"]
    });

    const response = await chrome.tabs.sendMessage(tabId, { type: "XHS_COLLECT_VISIBLE_FAVORITES" });
    const items = globalScope.FavExportNormalize.uniqueByUrlOrTitle(response?.items || []);
    logger?.info("小红书当前页面采集完成", { count: items.length });

    return {
      items,
      invalidItems: [],
      summary: {
        platformLabel: "小红书",
        folderNames: ["小红书收藏"],
        timeRangeText: "当前页面已加载内容",
        totalCount: items.length,
        successCount: items.length,
        invalidCount: 0,
        failedCount: logger?.entries.filter((entry) => entry.level === "error").length || 0,
        description: "小红书首版仅解析当前收藏页面已加载、可见的笔记卡片；收藏时间和发布时间可能为空。"
      }
    };
  }

  globalScope.FavExportXiaohongshu = {
    collectFromCurrentTab
  };
})(globalThis);
