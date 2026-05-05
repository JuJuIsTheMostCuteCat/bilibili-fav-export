importScripts(
  "../../libs/xlsx.full.min.js",
  "../utils/date.js",
  "../utils/logger.js",
  "../utils/normalize.js",
  "../export/excel.js",
  "../platforms/bilibili.js",
  "../platforms/youtube.js",
  "../platforms/xiaohongshu.js"
);

const runningJobs = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_BILI_STATUS":
      return getBiliStatus();
    case "GET_BILI_UP_STATUS":
      return getBiliUpStatus(message.options);
    case "START_BILI_EXPORT":
      return startBiliExport(message.options);
    case "START_BILI_UP_EXPORT":
      return startBiliUpExport(message.options);
    case "START_YOUTUBE_EXPORT":
      return startYoutubeExport(message.options);
    case "START_XHS_EXPORT":
      return startXhsExport(message.options);
    case "CANCEL_EXPORT":
      return cancelExport(message.jobId);
    default:
      throw new Error("未知操作");
  }
}

async function getBiliStatus() {
  const logger = FavExportLogger.createLogger();
  const { login, folders } = await FavExportBilibili.getFolders(logger);
  return {
    login,
    folders,
    errors: logger.entries
  };
}

async function getBiliUpStatus(options) {
  const logger = FavExportLogger.createLogger();
  const up = await FavExportBilibili.getUpArchiveOverview(options, logger);
  return {
    up,
    errors: logger.entries
  };
}

async function startBiliExport(options) {
  const job = createJob("bilibili");
  const logger = FavExportLogger.createLogger();

  try {
    if (!options?.folders?.length) {
      throw new Error("请至少选择一个 B 站收藏夹");
    }

    sendProgress(job.id, "bilibili", {
      processed: 0,
      total: options.folders.reduce((sum, folder) => sum + Number(folder.mediaCount || 0), 0),
      message: "开始导出 B 站收藏夹"
    });

    const result = await FavExportBilibili.exportFolders(
      options,
      (progress) => sendProgress(job.id, "bilibili", progress),
      () => job.cancelled,
      logger
    );

    const filename = await downloadWorkbook({
      items: result.items,
      invalidItems: result.invalidItems,
      errors: logger.entries,
      summary: result.summary
    });

    runningJobs.delete(job.id);
    return {
      jobId: job.id,
      filename,
      itemCount: result.items.length,
      invalidCount: result.invalidItems.length
    };
  } catch (error) {
    logger.error("B 站导出失败", String(error));
    runningJobs.delete(job.id);
    throw error;
  }
}

async function startBiliUpExport(options) {
  const job = createJob("bilibili-up");
  const logger = FavExportLogger.createLogger();

  try {
    if (!options?.up?.mid) {
      throw new Error("请输入 UP 主 UID 或空间链接");
    }

    sendProgress(job.id, "bilibili", {
      processed: 0,
      total: Number(options.up.total || 0),
      message: "开始导出 B 站 UP 主投稿"
    });

    const result = await FavExportBilibili.exportUpArchives(
      options,
      (progress) => sendProgress(job.id, "bilibili", progress),
      () => job.cancelled,
      logger
    );

    const filename = await downloadWorkbook({
      items: result.items,
      invalidItems: result.invalidItems,
      errors: logger.entries,
      summary: result.summary
    });

    runningJobs.delete(job.id);
    return {
      jobId: job.id,
      filename,
      itemCount: result.items.length,
      invalidCount: result.invalidItems.length
    };
  } catch (error) {
    logger.error("B 站 UP 主投稿导出失败", String(error));
    runningJobs.delete(job.id);
    throw error;
  }
}

async function startXhsExport(options) {
  const job = createJob("xiaohongshu");
  const logger = FavExportLogger.createLogger();

  try {
    if (!options?.tabId) {
      throw new Error("请先打开小红书收藏页面");
    }

    sendProgress(job.id, "xiaohongshu", {
      processed: 0,
      total: 0,
      message: "正在解析当前页面已加载内容"
    });

    const result = await FavExportXiaohongshu.collectFromCurrentTab(options.tabId, logger);
    const filename = await downloadWorkbook({
      items: result.items,
      invalidItems: result.invalidItems,
      errors: logger.entries,
      summary: result.summary
    });

    runningJobs.delete(job.id);
    return {
      jobId: job.id,
      filename,
      itemCount: result.items.length,
      invalidCount: 0
    };
  } catch (error) {
    logger.error("小红书导出失败", String(error));
    runningJobs.delete(job.id);
    throw error;
  }
}

async function startYoutubeExport(options) {
  const job = createJob("youtube");
  const logger = FavExportLogger.createLogger();

  try {
    if (!options?.tabId) {
      throw new Error("请先打开 YouTube 页面");
    }

    sendProgress(job.id, "youtube", {
      processed: 0,
      total: 0,
      message: options.includeCaptions === false ? "正在解析 YouTube 当前页面" : "正在解析 YouTube 当前页面和字幕"
    });

    const result = await FavExportYoutube.collectFromCurrentTab(options.tabId, options, logger);
    const filename = await downloadWorkbook({
      items: result.items,
      invalidItems: result.invalidItems,
      errors: logger.entries,
      summary: result.summary
    });

    runningJobs.delete(job.id);
    return {
      jobId: job.id,
      filename,
      itemCount: result.items.length,
      invalidCount: 0
    };
  } catch (error) {
    logger.error("YouTube 导出失败", String(error));
    runningJobs.delete(job.id);
    throw error;
  }
}

function createJob(platform) {
  const job = {
    id: `${platform}-${Date.now()}`,
    platform,
    cancelled: false
  };
  runningJobs.set(job.id, job);
  return job;
}

function cancelExport(jobId) {
  const job = runningJobs.get(jobId);
  if (!job) return { cancelled: false };
  job.cancelled = true;
  return { cancelled: true };
}

function sendProgress(jobId, platform, progress) {
  const message = {
    type: "EXPORT_PROGRESS",
    jobId,
    platform,
    processed: progress.processed || 0,
    total: progress.total || 0,
    currentFolder: progress.currentFolder || "",
    message: progress.message || ""
  };

  // Popup may be closed while a job is still running. In MV3, an unhandled
  // runtime.sendMessage rejection shows as "Receiving end does not exist".
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function downloadWorkbook(payload) {
  const workbook = FavExportExcel.createWorkbook(payload);
  const url = FavExportExcel.workbookToDataUrl(workbook);
  const filename = FavExportExcel.buildFilename(payload.summary.platformLabel);

  await chrome.downloads.download({
    url,
    filename,
    saveAs: true,
    conflictAction: "uniquify"
  });

  return filename;
}
