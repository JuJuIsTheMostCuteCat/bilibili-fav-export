const state = {
  activeTab: null,
  folders: [],
  currentJobId: "",
  isExporting: false
};

const els = {
  platform: document.querySelector("#platform"),
  pageStatus: document.querySelector("#page-status"),
  biliPanel: document.querySelector("#bili-panel"),
  xhsPanel: document.querySelector("#xhs-panel"),
  loadBili: document.querySelector("#load-bili"),
  selectAll: document.querySelector("#select-all"),
  biliLogin: document.querySelector("#bili-login"),
  folderList: document.querySelector("#folder-list"),
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
els.platform.addEventListener("change", renderPlatformPanel);
els.loadBili.addEventListener("click", loadBiliFolders);
els.selectAll.addEventListener("click", selectAllFolders);
els.timeFilter.addEventListener("change", () => {
  els.customTime.classList.toggle("hidden", els.timeFilter.value !== "custom");
});
els.exportButton.addEventListener("click", startExport);
els.cancelButton.addEventListener("click", cancelExport);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "EXPORT_PROGRESS") return;
  state.currentJobId = message.jobId;
  updateProgress(message);
});

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.activeTab = tab;
  detectPlatform(tab?.url || "");
  renderPlatformPanel();
}

function detectPlatform(url) {
  if (url.includes("xiaohongshu.com")) {
    els.platform.value = "xiaohongshu";
    els.pageStatus.textContent = "当前页面：小红书";
    return;
  }

  if (url.includes("bilibili.com")) {
    els.platform.value = "bilibili";
    els.pageStatus.textContent = "当前页面：Bilibili";
    loadBiliFolders();
    return;
  }

  els.pageStatus.textContent = "请打开 B 站或小红书页面后使用。";
}

function renderPlatformPanel() {
  const platform = els.platform.value;
  els.biliPanel.classList.toggle("hidden", platform !== "bilibili");
  els.xhsPanel.classList.toggle("hidden", platform !== "xiaohongshu");
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
}

function selectAllFolders() {
  const checkboxes = [...els.folderList.querySelectorAll("input[type='checkbox']")];
  const shouldCheck = checkboxes.some((checkbox) => !checkbox.checked);
  checkboxes.forEach((checkbox) => {
    checkbox.checked = shouldCheck;
  });
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
    const response =
      platform === "bilibili"
        ? await sendMessage({ type: "START_BILI_EXPORT", options: buildBiliOptions() })
        : await sendMessage({ type: "START_XHS_EXPORT", options: { tabId: state.activeTab?.id } });

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
