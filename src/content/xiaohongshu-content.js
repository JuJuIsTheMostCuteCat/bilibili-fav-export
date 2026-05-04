(function injectXiaohongshuCollector() {
  // The page can survive extension reloads, while old content-script listeners do not.
  // Always register the listener for the current extension context.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "XHS_COLLECT_VISIBLE_FAVORITES") return false;

    try {
      sendResponse({ ok: true, items: collectVisibleNotes() });
    } catch (error) {
      sendResponse({ ok: false, items: [], error: String(error) });
    }

    return true;
  });

  function collectVisibleNotes() {
    const candidates = [
      ...document.querySelectorAll("section.note-item"),
      ...document.querySelectorAll(".note-item"),
      ...document.querySelectorAll("[data-note-id]"),
      ...document.querySelectorAll("a[href*='/explore/'], a[href*='/discovery/item/']")
    ];

    const cards = dedupeElements(candidates.map((node) => node.closest("section, article, .note-item, [data-note-id]") || node));

    return cards
      .map(parseCard)
      .filter((item) => item.url || item.title)
      .map((item) => ({
        platform: "xiaohongshu",
        folderName: "小红书收藏",
        title: item.title,
        url: item.url,
        coverUrl: item.coverUrl,
        author: item.author,
        authorUrl: item.authorUrl,
        favoriteTime: "",
        publishTime: "",
        status: "unknown",
        contentType: "笔记",
        tags: [],
        notes: ""
      }));
  }

  function parseCard(card) {
    const noteLink = card.querySelector("a[href*='/explore/'], a[href*='/discovery/item/']") || (card.matches("a") ? card : null);
    const authorLink = card.querySelector("a[href*='/user/profile/']");
    const image = card.querySelector("img");
    const titleElement =
      card.querySelector(".title") ||
      card.querySelector("[class*='title']") ||
      card.querySelector("span") ||
      noteLink;

    return {
      title: cleanText(titleElement?.textContent || image?.alt || noteLink?.getAttribute("title") || ""),
      url: absoluteUrl(noteLink?.getAttribute("href") || ""),
      coverUrl: normalizeImageUrl(image?.currentSrc || image?.src || ""),
      author: cleanText(authorLink?.textContent || card.querySelector("[class*='author'], [class*='user']")?.textContent || ""),
      authorUrl: absoluteUrl(authorLink?.getAttribute("href") || "")
    };
  }

  function dedupeElements(elements) {
    const seen = new Set();
    return elements.filter((element) => {
      if (!element || seen.has(element)) return false;
      seen.add(element);
      return true;
    });
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function absoluteUrl(value) {
    if (!value) return "";
    try {
      return new URL(value, location.origin).href.split("?")[0];
    } catch (_error) {
      return "";
    }
  }

  function normalizeImageUrl(value) {
    if (!value) return "";
    if (value.startsWith("data:")) return "";
    return absoluteUrl(value);
  }
})();
