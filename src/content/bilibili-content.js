(function injectBilibiliHelper() {
  if (window.__favExporterBiliInjected) return;
  window.__favExporterBiliInjected = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "BILI_PAGE_STATUS") return false;
    sendResponse({
      ok: true,
      href: location.href,
      title: document.title
    });
    return true;
  });
})();
