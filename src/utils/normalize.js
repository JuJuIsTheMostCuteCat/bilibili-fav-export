(function attachNormalizeUtils(globalScope) {
  const EMPTY_ITEM = {
    platform: "",
    folderName: "",
    title: "",
    url: "",
    coverUrl: "",
    author: "",
    authorFollowerCount: "",
    authorVideoCount: "",
    authorUrl: "",
    description: "",
    videoTags: [],
    favoriteTime: "",
    publishTime: "",
    status: "unknown",
    contentType: "",
    tags: [],
    notes: ""
  };

  function normalizeFavoriteItem(item) {
    const normalized = { ...EMPTY_ITEM, ...item };
    return {
      platform: normalized.platform || "",
      folder_name: normalized.folderName || "",
      title: normalized.title || "",
      url: normalized.url || "",
      cover_url: normalized.coverUrl || "",
      cover_image: normalized.coverUrl || "",
      author: normalized.author || "",
      author_follower_count: normalized.authorFollowerCount ?? "",
      author_video_count: normalized.authorVideoCount ?? "",
      author_url: normalized.authorUrl || "",
      description: normalized.description || "",
      video_tags: Array.isArray(normalized.videoTags) ? normalized.videoTags.join(", ") : normalized.videoTags || "",
      favorite_time: normalized.favoriteTime || "",
      publish_time: normalized.publishTime || "",
      status: normalized.status || "unknown",
      content_type: normalized.contentType || "",
      tags: Array.isArray(normalized.tags) ? normalized.tags.join(", ") : normalized.tags || "",
      notes: normalized.notes || "",
      exported_at: globalScope.FavExportDate?.formatDateTime(new Date()) || new Date().toISOString()
    };
  }

  function uniqueByUrlOrTitle(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = item.url || `${item.title || ""}::${item.author || ""}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  globalScope.FavExportNormalize = {
    normalizeFavoriteItem,
    uniqueByUrlOrTitle
  };
})(globalThis);
