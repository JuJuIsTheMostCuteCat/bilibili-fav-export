(function attachBilibiliPlatform(globalScope) {
  const API = {
    nav: "https://api.bilibili.com/x/web-interface/nav",
    folders: (mid) => `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${encodeURIComponent(mid)}&jsonp=jsonp`,
    resources: (folderId, page, pageSize) =>
      `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${encodeURIComponent(folderId)}&pn=${page}&ps=${pageSize}&keyword=&order=mtime&type=0&tid=0&platform=web`,
    videoView: (identity) => `https://api.bilibili.com/x/web-interface/view?${identity.query}`,
    videoTags: (identity) => `https://api.bilibili.com/x/tag/archive/tags?${identity.query}`,
    authorRelationStat: (mid) => `https://api.bilibili.com/x/relation/stat?vmid=${encodeURIComponent(mid)}`,
    authorCard: (mid) => `https://api.bilibili.com/x/web-interface/card?mid=${encodeURIComponent(mid)}&photo=true`,
    authorNavNum: (mid) => `https://api.bilibili.com/x/space/navnum?mid=${encodeURIComponent(mid)}`
  };

  const PAGE_SIZE = 20;

  async function fetchJson(url, logger, retries = 2) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json, text/plain, */*"
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const json = await response.json();
        if (json.code !== 0) {
          throw new Error(json.message || `Bilibili API code ${json.code}`);
        }
        return json.data;
      } catch (error) {
        lastError = error;
        logger?.warn("B 站请求失败，准备重试", { url, attempt: attempt + 1, error: String(error) });
        if (attempt < retries) await delay(500 + attempt * 500);
      }
    }

    throw lastError;
  }

  async function getLoginState(logger) {
    const data = await fetchJson(API.nav, logger);
    return {
      isLogin: Boolean(data.isLogin),
      mid: data.mid ? String(data.mid) : "",
      username: data.uname || ""
    };
  }

  async function getFolders(logger) {
    const login = await getLoginState(logger);
    if (!login.isLogin || !login.mid) {
      return { login, folders: [] };
    }

    const data = await fetchJson(API.folders(login.mid), logger);
    const folders = (data.list || []).map((folder) => ({
      id: String(folder.id),
      title: folder.title || "未命名收藏夹",
      mediaCount: Number(folder.media_count || folder.mediaCount || 0),
      platform: "bilibili"
    }));

    return { login, folders };
  }

  async function exportFolders(options, onProgress, shouldCancel, logger) {
    const selectedFolders = options.folders || [];
    const total = selectedFolders.reduce((sum, folder) => sum + Number(folder.mediaCount || 0), 0);
    const validItems = [];
    const invalidItems = [];
    const authorStatsCache = new Map();
    let processed = 0;

    for (const folder of selectedFolders) {
      if (shouldCancel?.()) throw new Error("导出已取消");

      let page = 1;
      let hasMore = true;
      let emptyPageCount = 0;

      while (hasMore) {
        if (shouldCancel?.()) throw new Error("导出已取消");

        try {
          const data = await fetchJson(API.resources(folder.id, page, PAGE_SIZE), logger);
          const medias = data.medias || [];
          const expectedTotal = getExpectedFolderTotal(folder, data);

          logger?.info("B 站收藏夹分页结果", {
            folderId: folder.id,
            folderName: folder.title,
            page,
            pageSize: PAGE_SIZE,
            currentPageCount: medias.length,
            folderMediaCount: folder.mediaCount,
            apiMediaCount: data.info?.media_count,
            expectedTotal
          });

          for (const media of medias) {
            const item = normalizeMedia(media, folder.title);
            processed += 1;

            if (!globalScope.FavExportDate.isWithinTimeRange(item.favoriteTime, options.timeFilter)) {
              continue;
            }

            if (item.status === "invalid") {
              invalidItems.push(item);
              if (options.invalidMode === "all") validItems.push(item);
              continue;
            }

            await enrichVideoMetadata(item, media, logger, authorStatsCache);
            validItems.push(item);
          }

          onProgress?.({
            processed,
            total: total || expectedTotal || processed,
            currentFolder: folder.title,
            message: `正在导出：${processed} / ${total || expectedTotal || processed}`
          });

          emptyPageCount = medias.length === 0 ? emptyPageCount + 1 : 0;
          hasMore = emptyPageCount < 2 && page * PAGE_SIZE < expectedTotal;
          page += 1;
          if (hasMore) await delay(300 + Math.floor(Math.random() * 500));
        } catch (error) {
          logger?.error("B 站收藏夹分页导出失败", {
            folderId: folder.id,
            folderName: folder.title,
            page,
            error: String(error)
          });
          throw error;
        }
      }
    }

    return {
      items: options.invalidMode === "filter" ? validItems.filter((item) => item.status !== "invalid") : validItems,
      invalidItems,
      summary: {
        platformLabel: "B站",
        folderNames: selectedFolders.map((folder) => folder.title),
        timeRangeText: describeTimeFilter(options.timeFilter),
        totalCount: validItems.length + invalidItems.length,
        successCount: validItems.filter((item) => item.status !== "invalid").length,
        invalidCount: invalidItems.length,
        failedCount: logger?.entries.filter((entry) => entry.level === "error").length || 0,
        description: "B 站数据来自当前浏览器已登录账号可访问的收藏夹接口；未上传任何数据。"
      }
    };
  }

  function getExpectedFolderTotal(folder, data) {
    const folderTotal = Number(folder.mediaCount || 0);
    const apiTotal = Number(data.info?.media_count || 0);
    const pageTotal = Number(data.info?.total || 0);
    return Math.max(folderTotal, apiTotal, pageTotal);
  }

  function normalizeMedia(media, folderName) {
    const upper = media.upper || {};
    const favoriteTime = globalScope.FavExportDate.formatDateTime(media.fav_time || media.favTime);
    const publishTime = globalScope.FavExportDate.formatDateTime(media.pubtime || media.ctime);
    const status = isInvalidMedia(media) ? "invalid" : "normal";

    return {
      platform: "bilibili",
      folderName,
      title: media.title || "",
      url: buildMediaUrl(media),
      coverUrl: normalizeUrl(media.cover || media.pic || ""),
      author: upper.name || "",
      authorMid: upper.mid ? String(upper.mid) : "",
      authorFollowerCount: "",
      authorVideoCount: "",
      authorUrl: upper.mid ? `https://space.bilibili.com/${upper.mid}` : "",
      description: cleanText(media.intro || media.desc || ""),
      videoTags: [],
      favoriteTime,
      publishTime,
      status,
      contentType: mapContentType(media.type),
      tags: [],
      notes: ""
    };
  }

  async function enrichVideoMetadata(item, media, logger, authorStatsCache) {
    const identity = getVideoIdentity(media);
    const authorMid = item.authorMid || media.upper?.mid;

    try {
      const [detail, tagList, authorStats] = await Promise.all([
        identity
          ? fetchJson(API.videoView(identity), logger, 1).catch((error) => {
              logger?.warn("B 站视频简介读取失败", { title: item.title, url: item.url, error: String(error) });
              return null;
            })
          : Promise.resolve(null),
        identity
          ? fetchJson(API.videoTags(identity), logger, 1).catch((error) => {
              logger?.warn("B 站视频标签读取失败", { title: item.title, url: item.url, error: String(error) });
              return [];
            })
          : Promise.resolve([]),
        getAuthorStats(authorMid, authorStatsCache, logger).catch((error) => {
          logger?.warn("B 站作者数据读取失败", {
            title: item.title,
            author: item.author,
            authorMid,
            error: String(error)
          });
          return null;
        })
      ]);

      if (detail?.desc) {
        item.description = cleanText(detail.desc);
      }

      if (Array.isArray(tagList)) {
        item.videoTags = tagList.map((tag) => tag.tag_name || tag.name || "").filter(Boolean);
      }

      if (authorStats) {
        item.authorFollowerCount = authorStats.followerCount;
        item.authorVideoCount = authorStats.videoCount;
      }
    } catch (error) {
      logger?.warn("B 站视频详情补充失败", { title: item.title, url: item.url, error: String(error) });
    }
  }

  async function getAuthorStats(authorMid, authorStatsCache, logger) {
    if (!authorMid) return null;
    const cacheKey = String(authorMid);
    if (authorStatsCache?.has(cacheKey)) return authorStatsCache.get(cacheKey);

    const [relationStat, authorCard] = await Promise.all([
      fetchJson(API.authorRelationStat(cacheKey), logger, 1).catch((error) => {
        logger?.warn("B 站作者粉丝数读取失败", { authorMid: cacheKey, error: String(error) });
        return null;
      }),
      fetchJson(API.authorCard(cacheKey), logger, 1).catch((error) => {
        logger?.warn("B 站作者卡片读取失败", { authorMid: cacheKey, error: String(error) });
        return null;
      })
    ]);

    const followerCount = firstNumber(relationStat?.follower, authorCard?.card?.fans);
    let videoCount = firstNumber(authorCard?.card?.archive_count, authorCard?.archive_count);

    if (videoCount === "") {
      const navNum = await fetchJson(API.authorNavNum(cacheKey), logger, 0).catch((error) => {
        logger?.warn("B 站作者投稿数兜底读取失败", { authorMid: cacheKey, error: String(error) });
        return null;
      });
      videoCount = firstNumber(navNum?.video);
    }

    const stats = {
      followerCount,
      videoCount
    };

    authorStatsCache?.set(cacheKey, stats);
    return stats;
  }

  function firstNumber(...values) {
    for (const value of values) {
      const numberValue = Number(value);
      if (Number.isFinite(numberValue)) return numberValue;
    }
    return "";
  }

  function getVideoIdentity(media) {
    const bvid = media.bvid || media.bv_id || media.bvId || "";
    if (bvid) return { query: `bvid=${encodeURIComponent(bvid)}` };
    if (media.id) return { query: `aid=${encodeURIComponent(media.id)}` };
    return null;
  }

  function buildMediaUrl(media) {
    const bvid = media.bvid || media.bv_id || media.bvId || "";
    if (bvid) return `https://www.bilibili.com/video/${bvid}`;

    const link = normalizeUrl(media.link || "");
    if (!link) {
      return media.id ? `https://www.bilibili.com/video/av${media.id}` : "";
    }

    if (link.startsWith("bilibili://video/")) {
      const videoId = link.replace("bilibili://video/", "").split(/[/?#]/)[0];
      return videoId ? `https://www.bilibili.com/video/av${videoId}` : "";
    }

    if (link.startsWith("bilibili://")) {
      return media.id ? `https://www.bilibili.com/video/av${media.id}` : "";
    }

    return link;
  }

  function isInvalidMedia(media) {
    const title = media.title || "";
    return Boolean(
      media.attr === 9 ||
        media.state < 0 ||
        media.id === 0 ||
        title.includes("已失效") ||
        title.includes("失效视频")
    );
  }

  function mapContentType(type) {
    const value = Number(type);
    if (value === 2) return "视频";
    if (value === 12) return "音频";
    if (value === 21) return "合集";
    return value ? `类型 ${value}` : "其他";
  }

  function normalizeUrl(url) {
    if (!url) return "";
    if (url.startsWith("//")) return `https:${url}`;
    return url;
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function describeTimeFilter(filter) {
    if (!filter || filter.type === "all") return "全部";
    if (filter.type === "last7") return "最近 7 天";
    if (filter.type === "last30") return "最近 30 天";
    if (filter.type === "custom") return `${filter.startDate || "不限"} 至 ${filter.endDate || "不限"}`;
    return "全部";
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  globalScope.FavExportBilibili = {
    getLoginState,
    getFolders,
    exportFolders
  };
})(globalThis);
