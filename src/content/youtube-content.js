(function injectYoutubeCollector() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "YOUTUBE_COLLECT_VISIBLE_VIDEOS") return false;

    collectVisibleVideos(message.options || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, items: [], errors: [], error: String(error) }));

    return true;
  });

  async function collectVisibleVideos(options) {
    const includeCaptions = options.includeCaptions !== false;
    const errors = [];
    const videos = dedupeByUrl(findVideoCards().map(parseVideoCard).filter((item) => item.url || item.title));

    if (includeCaptions) {
      for (let index = 0; index < videos.length; index += 1) {
        const item = videos[index];
        if (!item.url) continue;

        try {
          item.subtitleText = await fetchSubtitleText(item.url);
        } catch (error) {
          errors.push({
            message: "YouTube 字幕读取失败",
            detail: { title: item.title, url: item.url, error: String(error) }
          });
        }
      }
    }

    return { items: videos, errors };
  }

  function findVideoCards() {
    const selectors = [
      "ytd-playlist-video-renderer",
      "ytd-rich-item-renderer",
      "ytd-video-renderer",
      "ytd-grid-video-renderer",
      "ytd-compact-video-renderer",
      "ytd-reel-item-renderer",
      "a[href*='/watch?v=']"
    ];
    const nodes = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    return dedupeElements(nodes.map((node) => node.closest("ytd-playlist-video-renderer, ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-reel-item-renderer") || node));
  }

  function parseVideoCard(card) {
    const link =
      card.querySelector("a#video-title[href*='/watch'], a#video-title-link[href*='/watch'], a#thumbnail[href*='/watch'], a[href*='/watch?v=']") ||
      (card.matches?.("a[href*='/watch?v=']") ? card : null);
    const titleElement =
      card.querySelector("#video-title") ||
      card.querySelector("#video-title-link") ||
      card.querySelector("h3 a") ||
      link;
    const image = card.querySelector("img");
    const channelLink = card.querySelector("#channel-name a, ytd-channel-name a, a[href^='/@'], a[href*='/channel/']");
    const metadataTexts = [...card.querySelectorAll("#metadata-line span, .ytd-video-meta-block span, span.inline-metadata-item")]
      .map((node) => cleanText(node.textContent))
      .filter(Boolean);
    const title = cleanText(titleElement?.textContent || titleElement?.getAttribute("title") || image?.alt || "");
    const url = normalizeWatchUrl(link?.href || link?.getAttribute("href") || "");
    const viewText = metadataTexts.find((text) => /view|观看|次观看/i.test(text)) || "";
    const publishText = metadataTexts.find((text) => !/view|观看|次观看/i.test(text)) || "";

    return {
      platform: "youtube",
      folderName: "YouTube 当前页面",
      title,
      url,
      coverUrl: normalizeImageUrl(image?.currentSrc || image?.src || ""),
      author: cleanText(channelLink?.textContent || ""),
      authorUrl: absoluteUrl(channelLink?.getAttribute("href") || ""),
      description: "",
      videoTags: [],
      viewCount: parseCompactNumber(viewText),
      likeCount: "",
      favoriteCount: "",
      coinCount: "",
      shareCount: "",
      commentCount: "",
      danmakuCount: "",
      duration: cleanText(card.querySelector("ytd-thumbnail-overlay-time-status-renderer, .ytd-thumbnail-overlay-time-status-renderer")?.textContent || ""),
      subtitleText: "",
      favoriteTime: "",
      publishTime: publishText,
      status: "normal",
      contentType: "视频",
      tags: [],
      notes: ""
    };
  }

  async function fetchSubtitleText(videoUrl) {
    const pageText = await fetch(videoUrl, { credentials: "include" }).then((response) => response.text());
    const playerResponse = extractPlayerResponse(pageText);
    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) return "";

    const track = chooseCaptionTrack(tracks);
    if (!track?.baseUrl) return "";

    const captionUrl = withFormat(track.baseUrl);
    const response = await fetch(captionUrl, { credentials: "include" });
    const text = await response.text();
    return parseCaptionResponse(text);
  }

  function extractPlayerResponse(pageText) {
    const patterns = [
      /ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*<\/script>/s,
      /"playerResponse":"(.+?)","/s
    ];

    for (const pattern of patterns) {
      const match = pageText.match(pattern);
      if (!match) continue;

      try {
        const raw = pattern.source.includes("playerResponse") ? JSON.parse(`"${match[1]}"`) : match[1];
        return JSON.parse(raw);
      } catch (_error) {
        continue;
      }
    }

    return null;
  }

  function chooseCaptionTrack(tracks) {
    return (
      tracks.find((track) => track.languageCode?.startsWith("zh")) ||
      tracks.find((track) => track.languageCode?.startsWith("en")) ||
      tracks[0]
    );
  }

  function withFormat(baseUrl) {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set("fmt", "json3");
      return url.href;
    } catch (_error) {
      return baseUrl;
    }
  }

  function parseCaptionResponse(text) {
    try {
      const json = JSON.parse(text);
      return (json.events || [])
        .flatMap((event) => event.segs || [])
        .map((seg) => cleanText(seg.utf8 || ""))
        .filter(Boolean)
        .join(" ");
    } catch (_error) {
      const doc = new DOMParser().parseFromString(text, "text/xml");
      return [...doc.querySelectorAll("text")]
        .map((node) => cleanText(node.textContent || ""))
        .filter(Boolean)
        .join(" ");
    }
  }

  function parseCompactNumber(text) {
    const value = cleanText(text).replace(/,/g, "");
    const match = value.match(/([\d.]+)\s*([KMB万亿]?)/i);
    if (!match) return "";

    const number = Number(match[1]);
    if (!Number.isFinite(number)) return "";

    const unit = match[2].toLowerCase();
    if (unit === "k") return Math.round(number * 1000);
    if (unit === "m") return Math.round(number * 1000000);
    if (unit === "b") return Math.round(number * 1000000000);
    if (unit === "万") return Math.round(number * 10000);
    if (unit === "亿") return Math.round(number * 100000000);
    return Math.round(number);
  }

  function dedupeElements(elements) {
    const seen = new Set();
    return elements.filter((element) => {
      if (!element || seen.has(element)) return false;
      seen.add(element);
      return true;
    });
  }

  function dedupeByUrl(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = item.url || item.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizeWatchUrl(value) {
    const url = absoluteUrl(value);
    if (!url) return "";

    try {
      const parsed = new URL(url);
      const videoId = parsed.searchParams.get("v");
      return videoId ? `https://www.youtube.com/watch?v=${videoId}` : url.split("&")[0];
    } catch (_error) {
      return url;
    }
  }

  function absoluteUrl(value) {
    if (!value) return "";
    try {
      return new URL(value, location.origin).href;
    } catch (_error) {
      return "";
    }
  }

  function normalizeImageUrl(value) {
    if (!value || value.startsWith("data:")) return "";
    return absoluteUrl(value);
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
})();
