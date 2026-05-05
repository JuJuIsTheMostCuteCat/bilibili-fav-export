const state = {
  activeTab: null,
  folders: [],
  up: null,
  currentJobId: "",
  isExporting: false,
  restored: null,
  isRestoring: false,
  saveTimer: null
};

const STORAGE_KEY = "favExportPopupState";

const els = {
  platform: document.querySelector("#platform"),
  pageStatus: document.querySelector("#page-status"),
  biliPanel: document.querySelector("#bili-panel"),
  youtubePanel: document.querySelector("#youtube-panel"),
  xhsPanel: document.querySelector("#xhs-panel"),
  biliSource: document.querySelector("#bili-source"),
  biliFavoritesOptions: document.querySelector("#bili-favorites-options"),
  biliUpOptions: document.querySelector("#bili-up-options"),
  loadBili: document.querySelector("#load-bili"),
  selectAll: document.querySelector("#select-all"),
  biliLogin: document.querySelector("#bili-login"),
  folderList: document.querySelector("#folder-list"),
  upInput: document.querySelector("#up-input"),
  loadUp: document.querySelector("#load-up"),
  upStatus: document.querySelector("#up-status"),
  upOrder: document.querySelector("#up-order"),
  upKeyword: document.querySelector("#up-keyword"),
  upTid: document.querySelector("#up-tid"),
  youtubeCaptions: document.querySelector("#youtube-captions"),
  timeFilterLabel: document.querySelector("#time-filter-label"),
  timeFilter: document.querySelector("#time-filter"),
  customTime: document.querySelector("#custom-time"),
  startDate: document.querySelector("#start-date"),
  endDate: document.querySelector("#end-date"),
  invalidMode: document.querySelector("#invalid-mode"),
  progressText: document.querySelector("#progress-text"),
  progressCount: document.querySelector("#progress-count"),
  progress: document.querySelector("#progress"),
  exportButton: document.querySelector("#export"),
  cancelButton: document.querySelector("#cancel"),
  message: document.querySelector("#message")
};

document.addEventListener("DOMContentLoaded", init);
els.platform.addEventListener("change", () => {
  renderPlatformPanel();
  scheduleSaveState();
});
els.biliSource.addEventListener("change", () => {
  renderBiliSourcePanel();
  scheduleSaveState();
});
els.loadBili.addEventListener("click", loadBiliFolders);
els.selectAll.addEventListener("click", selectAllFolders);
els.loadUp.addEventListener("click", loadUpOverview);
els.upInput.addEventListener("input", () => {
  if (state.up?.mid !== parseBiliMid(els.upInput.value)) {
    state.up = null;
    renderUpTidOptions([]);
    els.upStatus.textContent = "请输入 UP 主 UID 或空间链接。";
  }
  scheduleSaveState();
});
els.timeFilter.addEventListener("change", () => {
  els.customTime.classList.toggle("hidden", els.timeFilter.value !== "custom");
  scheduleSaveState();
});
els.exportButton.addEventListener("click", startExport);
els.cancelButton.addEventListener("click", cancelExport);

[
  els.upOrder,
  els.upKeyword,
  els.upTid,
  els.youtubeCaptions,
  els.startDate,
  els.endDate,
  els.invalidMode
].forEach((element) => {
  element?.addEventListener("change", scheduleSaveState);
  element?.addEventListener("input", scheduleSaveState);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "EXPORT_PROGRESS") return;
  state.currentJobId = message.jobId;
  updateProgress(message);
});

async function init() {
  state.isRestoring = true;
  await restoreState();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.activeTab = tab;
  detectPlatform(tab?.url || "");
  renderPlatformPanel();
  state.isRestoring = false;
  scheduleSaveState();
}

function detectPlatform(url) {
  const detected = getPlatformFromUrl(url);
  if (detected) {
    els.platform.value = detected;
    els.pageStatus.textContent = `当前页面：${getPlatformLabel(detected)}`;
    if (detected === "bilibili" && els.biliSource.value === "favorites") {
      loadBiliFolders();
    }
    return;
  }

  els.pageStatus.textContent = "请打开 B 站或小红书页面后使用。";
}

function getPlatformFromUrl(url) {
  if (url.includes("xiaohongshu.com")) {
    return "xiaohongshu";
  }

  if (url.includes("bilibili.com")) {
    return "bilibili";
  }

  return "";
}

function getPlatformLabel(platform) {
  if (platform === "bilibili") return "Bilibili";
  if (platform === "youtube") return "YouTube";
  if (platform === "xiaohongshu") return "小红书";
  return "未知平台";
}

function renderPlatformPanel() {
  const platform = els.platform.value;
  els.biliPanel.classList.toggle("hidden", platform !== "bilibili");
  els.youtubePanel.classList.toggle("hidden", platform !== "youtube");
  els.xhsPanel.classList.toggle("hidden", platform !== "xiaohongshu");
  renderBiliSourcePanel();
}

function renderBiliSourcePanel() {
  const isUpMode = els.biliSource.value === "up";
  els.biliFavoritesOptions.classList.toggle("hidden", isUpMode);
  els.biliUpOptions.classList.toggle("hidden", !isUpMode);
  els.timeFilterLabel.textContent = isUpMode ? "投稿时间" : "收藏时间";
}

async function loadBiliFolders() {
  setMessage("正在读取 B 站登录状态和收藏夹...", "");
  els.loadBili.disabled = true;

  try {
    const response = await sendMessage({ type: "GET_BILI_STATUS" });
    if (!response.login?.isLogin) {
      state.folders = [];
      els.biliLogin.textContent = "未检测到 B 站登录态，请先在浏览器中登录 B 站。";
      renderFolders();
      return;
    }

    state.folders = response.folders || [];
    els.biliLogin.textContent = `已登录：${response.login.username || response.login.mid}，识别 ${state.folders.length} 个收藏夹。`;
    renderFolders();
    restoreFolderSelection();
    setMessage("收藏夹读取完成。", "success");
  } catch (error) {
    setMessage(error.message || String(error), "error");
  } finally {
    els.loadBili.disabled = false;
  }
}

function renderFolders() {
  if (!state.folders.length) {
    els.folderList.innerHTML = '<div class="folder-item"><span class="folder-title">暂无收藏夹</span></div>';
    return;
  }

  els.folderList.innerHTML = state.folders
    .map(
      (folder) => `
        <label class="folder-item">
          <input type="checkbox" value="${escapeHtml(folder.id)}" />
          <span class="folder-title" title="${escapeHtml(folder.title)}">${escapeHtml(folder.title)}</span>
          <span class="folder-count">${Number(folder.mediaCount || 0)}</span>
        </label>
      `
    )
    .join("");
  [...els.folderList.querySelectorAll("input[type='checkbox']")].forEach((input) => {
    input.addEventListener("change", scheduleSaveState);
  });
}

function selectAllFolders() {
  const checkboxes = [...els.folderList.querySelectorAll("input[type='checkbox']")];
  const shouldCheck = checkboxes.some((checkbox) => !checkbox.checked);
  checkboxes.forEach((checkbox) => {
    checkbox.checked = shouldCheck;
  });
  scheduleSaveState();
}

async function loadUpOverview() {
  const mid = parseBiliMid(els.upInput.value);
  if (!mid) {
    setMessage("请输入有效的 UP 主 UID 或空间链接。", "error");
    return;
  }

  setMessage("正在读取 UP 主投稿信息...", "");
  els.loadUp.disabled = true;

  try {
    const response = await sendMessage({ type: "GET_BILI_UP_STATUS", options: { mid } });
    state.up = response.up || null;
    renderUpTidOptions(state.up?.tids || []);
    restoreUpTidSelection();
    els.upStatus.textContent = state.up
      ? `已识别：${state.up.name || state.up.mid}，公开视频约 ${Number(state.up.total || 0)} 个。`
      : "未读取到 UP 主投稿信息。";
    setMessage("UP 主投稿信息读取完成。", "success");
  } catch (error) {
    state.up = null;
    renderUpTidOptions([]);
    els.upStatus.textContent = "读取失败，请确认 UID 或稍后重试。";
    setMessage(error.message || String(error), "error");
  } finally {
    els.loadUp.disabled = false;
  }
}

function renderUpTidOptions(tids) {
  const options = [{ tid: "0", name: "全部分区", count: "" }, ...(tids || [])];
  els.upTid.innerHTML = options
    .map((item) => {
      const label = item.count === "" ? item.name : `${item.name} (${Number(item.count || 0)})`;
      return `<option value="${escapeHtml(item.tid)}">${escapeHtml(label)}</option>`;
    })
    .join("");
}

async function startExport() {
  if (state.isExporting) return;

  const platform = els.platform.value;
  state.isExporting = true;
  state.currentJobId = "";
  els.exportButton.disabled = true;
  els.cancelButton.disabled = false;
  setMessage("", "");
  updateProgress({ processed: 0, total: 100, message: "准备导出..." });

  try {
    const response = await startPlatformExport(platform);

    updateProgress({ processed: 100, total: 100, message: "导出完成" });
    setMessage(`已生成：${response.filename}，共导出 ${response.itemCount} 条。`, "success");
  } catch (error) {
    setMessage(error.message || String(error), "error");
  } finally {
    state.isExporting = false;
    els.exportButton.disabled = false;
    els.cancelButton.disabled = true;
  }
}

function startPlatformExport(platform) {
  if (platform === "bilibili") return startBiliExport();
  if (platform === "youtube") return sendMessage({ type: "START_YOUTUBE_EXPORT", options: buildYoutubeOptions() });
  return sendMessage({ type: "START_XHS_EXPORT", options: { tabId: state.activeTab?.id } });
}

function startBiliExport() {
  if (els.biliSource.value === "up") {
    return sendMessage({ type: "START_BILI_UP_EXPORT", options: buildBiliUpOptions() });
  }

  return sendMessage({ type: "START_BILI_EXPORT", options: buildBiliOptions() });
}

function buildBiliOptions() {
  const checkedIds = [...els.folderList.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
  const folders = state.folders.filter((folder) => checkedIds.includes(folder.id));

  return {
    folders,
    timeFilter: {
      type: els.timeFilter.value,
      startDate: els.startDate.value,
      endDate: els.endDate.value
    },
    invalidMode: els.invalidMode.value
  };
}

function buildYoutubeOptions() {
  return {
    tabId: state.activeTab?.id,
    includeCaptions: els.youtubeCaptions.checked
  };
}

function buildBiliUpOptions() {
  const mid = parseBiliMid(els.upInput.value) || state.up?.mid || "";
  const cachedUp = state.up?.mid === mid ? state.up : null;

  return {
    up: {
      mid,
      name: cachedUp?.name || "",
      total: cachedUp?.total || 0
    },
    order: els.upOrder.value,
    keyword: els.upKeyword.value.trim(),
    tid: els.upTid.value || "0",
    timeFilter: {
      type: els.timeFilter.value,
      startDate: els.startDate.value,
      endDate: els.endDate.value
    }
  };
}

function parseBiliMid(value) {
  const text = String(value || "").trim();
  if (/^\d+$/.test(text)) return text;

  const match = text.match(/space\.bilibili\.com\/(\d+)/i);
  return match ? match[1] : "";
}

async function cancelExport() {
  if (!state.currentJobId) return;
  await sendMessage({ type: "CANCEL_EXPORT", jobId: state.currentJobId });
  setMessage("正在取消导出...", "");
}

function updateProgress(progress) {
  const total = Number(progress.total || 0);
  const processed = Number(progress.processed || 0);
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  els.progress.value = percent;
  els.progressText.textContent = progress.message || "正在处理...";
  els.progressCount.textContent = total > 0 ? `${processed} / ${total}` : "";
}

function getSelectedFolderIds() {
  return [...els.folderList.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
}

function restoreFolderSelection() {
  const selectedIds = new Set(state.restored?.biliSelectedFolderIds || []);
  if (!selectedIds.size) return;
  [...els.folderList.querySelectorAll("input[type='checkbox']")].forEach((input) => {
    input.checked = selectedIds.has(input.value);
    input.addEventListener("change", scheduleSaveState);
  });
}

function restoreUpTidSelection() {
  const value = state.restored?.upTid;
  if (value && [...els.upTid.options].some((option) => option.value === value)) {
    els.upTid.value = value;
  }
}

async function restoreState() {
  const stored = await storageGet(STORAGE_KEY);
  state.restored = stored || {};

  setSelectValue(els.platform, state.restored.platform);
  setSelectValue(els.biliSource, state.restored.biliSource);
  setSelectValue(els.timeFilter, state.restored.timeFilter);
  setSelectValue(els.invalidMode, state.restored.invalidMode);
  setSelectValue(els.upOrder, state.restored.upOrder);

  els.upInput.value = state.restored.upInput || "";
  els.upKeyword.value = state.restored.upKeyword || "";
  els.startDate.value = state.restored.startDate || "";
  els.endDate.value = state.restored.endDate || "";
  els.youtubeCaptions.checked = state.restored.youtubeCaptions !== false;
  els.customTime.classList.toggle("hidden", els.timeFilter.value !== "custom");
}

function setSelectValue(select, value) {
  if (!select || value === undefined || value === null) return;
  if ([...select.options].some((option) => option.value === value)) {
    select.value = value;
  }
}

function scheduleSaveState() {
  if (state.isRestoring) return;
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(saveState, 150);
}

async function saveState() {
  const snapshot = {
    platform: els.platform.value,
    biliSource: els.biliSource.value,
    biliSelectedFolderIds: getSelectedFolderIds(),
    upInput: els.upInput.value,
    upOrder: els.upOrder.value,
    upKeyword: els.upKeyword.value,
    upTid: els.upTid.value,
    timeFilter: els.timeFilter.value,
    startDate: els.startDate.value,
    endDate: els.endDate.value,
    invalidMode: els.invalidMode.value,
    youtubeCaptions: els.youtubeCaptions.checked
  };
  state.restored = snapshot;
  await storageSet(STORAGE_KEY, snapshot);
}

function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => resolve(result?.[key] || null));
  });
}

function storageSet(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "操作失败"));
        return;
      }

      resolve(response);
    });
  });
}

function setMessage(text, type) {
  els.message.textContent = text;
  els.message.className = `message ${type || ""}`.trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
