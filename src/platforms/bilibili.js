(function attachBilibiliPlatform(globalScope) {
  const API = {
    nav: "https://api.bilibili.com/x/web-interface/nav",
    folders: (mid) => `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${encodeURIComponent(mid)}&jsonp=jsonp`,
    resources: (folderId, page, pageSize) =>
      `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${encodeURIComponent(folderId)}&pn=${page}&ps=${pageSize}&keyword=&order=mtime&type=0&tid=0&platform=web`,
    upArchives: (query) => `https://api.bilibili.com/x/space/wbi/arc/search?${query}`,
    videoView: (identity) => `https://api.bilibili.com/x/web-interface/view?${identity.query}`,
    videoTags: (identity) => `https://api.bilibili.com/x/tag/archive/tags?${identity.query}`,
    authorRelationStat: (mid) => `https://api.bilibili.com/x/relation/stat?vmid=${encodeURIComponent(mid)}`,
    authorCard: (mid) => `https://api.bilibili.com/x/web-interface/card?mid=${encodeURIComponent(mid)}&photo=true`,
    authorNavNum: (mid) => `https://api.bilibili.com/x/space/navnum?mid=${encodeURIComponent(mid)}`
  };

  const PAGE_SIZE = 20;
  const UP_PAGE_SIZE = 30;
  const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12,
    38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57,
    62, 11, 36, 20, 34, 44, 52
  ];
  let wbiKeyCache = null;

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

  async function getUpArchiveOverview(options, logger) {
    const mid = String(options?.mid || "").trim();
    if (!mid) throw new Error("请输入 UP 主 UID");

    const data = await fetchUpArchivePage(
      {
        mid,
        page: 1,
        pageSize: 1,
        order: "pubdate",
        tid: 0,
        keyword: ""
      },
      logger
    );
    const firstArchive = data.list?.vlist?.[0] || null;
    const authorCard = await fetchJson(API.authorCard(mid), logger, 1).catch((error) => {
      logger?.warn("B 站 UP 主卡片读取失败", { mid, error: String(error) });
      return null;
    });

    return {
      mid,
      name: authorCard?.card?.name || firstArchive?.author || "",
      total: Number(data.page?.count || 0),
      tids: normalizeTidList(data.list?.tlist)
    };
  }

  async function exportUpArchives(options, onProgress, shouldCancel, logger) {
    const up = options.up || {};
    const mid = String(up.mid || "").trim();
    if (!mid) throw new Error("请输入 UP 主 UID");

    const validItems = [];
    const invalidItems = [];
    const authorStatsCache = new Map();
    const order = options.order || "pubdate";
    const tid = options.tid || 0;
    const keyword = options.keyword || "";
    let page = 1;
    let processed = 0;
    let expectedTotal = Number(up.total || 0);
    let upName = up.name || "";
    let hasMore = true;

    while (hasMore) {
      if (shouldCancel?.()) throw new Error("导出已取消");

      const data = await fetchUpArchivePage(
        {
          mid,
          page,
          pageSize: UP_PAGE_SIZE,
          order,
          tid,
          keyword
        },
        logger
      );
      const archives = data.list?.vlist || [];
      expectedTotal = Number(data.page?.count || expectedTotal || archives.length);
      if (!upName && archives[0]?.author) upName = archives[0].author;

      logger?.info("B 站 UP 主投稿分页结果", {
        mid,
        upName,
        page,
        pageSize: UP_PAGE_SIZE,
        currentPageCount: archives.length,
        expectedTotal
      });

      for (const archive of archives) {
        const item = normalizeUpArchive(archive, upName || mid);
        processed += 1;

        if (!globalScope.FavExportDate.isWithinTimeRange(item.publishTime, options.timeFilter)) {
          continue;
        }

        await enrichVideoMetadata(item, archive, logger, authorStatsCache);
        validItems.push(item);
      }

      onProgress?.({
        processed,
        total: expectedTotal || processed,
        currentFolder: upName || mid,
        message: `正在导出 UP 主投稿：${processed} / ${expectedTotal || processed}`
      });

      hasMore = archives.length > 0 && page * UP_PAGE_SIZE < expectedTotal;
      page += 1;
      if (hasMore) await delay(300 + Math.floor(Math.random() * 500));
    }

    return {
      items: validItems,
      invalidItems,
      summary: {
        platformLabel: "B站UP主",
        folderNames: [`UP投稿：${upName || mid}`],
        timeRangeText: describeTimeFilter(options.timeFilter),
        totalCount: validItems.length,
        successCount: validItems.length,
        invalidCount: 0,
        failedCount: logger?.entries.filter((entry) => entry.level === "error").length || 0,
        description: "B 站数据来自指定 UP 主公开投稿接口；发布时间范围在本地根据投稿时间过滤；未上传任何数据。"
      }
    };
  }

  async function fetchUpArchivePage({ mid, page, pageSize, order, tid, keyword }, logger) {
    const query = await signWbiParams(
      {
        mid,
        pn: page || 1,
        ps: pageSize || UP_PAGE_SIZE,
        order: order || "pubdate",
        tid: tid || 0,
        keyword: keyword || ""
      },
      logger
    );
    const data = await fetchJson(API.upArchives(query), logger);
    if (data?.v_voucher) {
      throw new Error("B 站 WBI 风控校验失败，请刷新 B 站页面或稍后重试");
    }
    if (!data?.list || !data?.page) {
      throw new Error("B 站 UP 主投稿接口返回格式异常");
    }
    return data;
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
    const stat = media.cnt_info || {};
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
      viewCount: firstNumber(stat.play, media.play),
      likeCount: firstNumber(stat.thumb_up, stat.like),
      favoriteCount: firstNumber(stat.collect, stat.favorite),
      coinCount: firstNumber(stat.coin),
      shareCount: firstNumber(stat.share),
      commentCount: firstNumber(stat.reply, stat.comment),
      danmakuCount: firstNumber(stat.danmaku),
      duration: media.duration || "",
      subtitleText: "",
      favoriteTime,
      publishTime,
      status,
      contentType: mapContentType(media.type),
      tags: [],
      notes: ""
    };
  }

  function normalizeUpArchive(archive, upName) {
    const publishTime = globalScope.FavExportDate.formatDateTime(archive.created || archive.ctime);
    const bvid = archive.bvid || "";
    const aid = archive.aid || archive.id || "";
    const notes = [
      archive.typeid ? `分区 ${archive.typeid}` : "",
      archive.is_union_video ? "合作视频" : "",
      archive.meta?.name ? `合集 ${archive.meta.name}` : ""
    ].filter(Boolean);

    return {
      platform: "bilibili",
      folderName: `UP投稿 / ${upName || archive.author || archive.mid || ""}`,
      title: archive.title || "",
      url: bvid ? `https://www.bilibili.com/video/${bvid}` : aid ? `https://www.bilibili.com/video/av${aid}` : "",
      coverUrl: normalizeUrl(archive.pic || archive.cover || ""),
      author: archive.author || upName || "",
      authorMid: archive.mid ? String(archive.mid) : "",
      authorFollowerCount: "",
      authorVideoCount: "",
      authorUrl: archive.mid ? `https://space.bilibili.com/${archive.mid}` : "",
      description: cleanText(archive.description || archive.desc || ""),
      videoTags: [],
      viewCount: firstNumber(archive.play),
      likeCount: "",
      favoriteCount: "",
      coinCount: "",
      shareCount: "",
      commentCount: firstNumber(archive.comment),
      danmakuCount: firstNumber(archive.video_review),
      duration: archive.length || "",
      subtitleText: "",
      favoriteTime: "",
      publishTime,
      status: "normal",
      contentType: archive.is_lesson_video ? "课堂" : archive.is_live_playback ? "直播回放" : "视频",
      tags: [],
      notes: notes.join("；")
    };
  }

  function normalizeTidList(tlist) {
    return Object.values(tlist || {})
      .map((item) => ({
        tid: String(item.tid || ""),
        name: item.name || `分区 ${item.tid}`,
        count: Number(item.count || 0)
      }))
      .filter((item) => item.tid)
      .sort((a, b) => b.count - a.count);
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

      if (detail?.stat) {
        item.viewCount = firstNumber(item.viewCount, detail.stat.view);
        item.likeCount = firstNumber(item.likeCount, detail.stat.like);
        item.favoriteCount = firstNumber(item.favoriteCount, detail.stat.favorite);
        item.coinCount = firstNumber(item.coinCount, detail.stat.coin);
        item.shareCount = firstNumber(item.shareCount, detail.stat.share);
        item.commentCount = firstNumber(item.commentCount, detail.stat.reply);
        item.danmakuCount = firstNumber(item.danmakuCount, detail.stat.danmaku);
      }

      if (!item.duration && detail?.duration) {
        item.duration = formatDuration(detail.duration);
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
      if (value === "" || value === null || value === undefined) continue;
      const numberValue = Number(value);
      if (Number.isFinite(numberValue)) return numberValue;
    }
    return "";
  }

  function formatDuration(seconds) {
    const totalSeconds = Number(seconds);
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "";
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const rest = Math.floor(totalSeconds % 60);
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
    }
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  }

  function getVideoIdentity(media) {
    const bvid = media.bvid || media.bv_id || media.bvId || "";
    if (bvid) return { query: `bvid=${encodeURIComponent(bvid)}` };
    if (media.aid) return { query: `aid=${encodeURIComponent(media.aid)}` };
    if (media.id) return { query: `aid=${encodeURIComponent(media.id)}` };
    return null;
  }

  function buildMediaUrl(media) {
    const bvid = media.bvid || media.bv_id || media.bvId || "";
    if (bvid) return `https://www.bilibili.com/video/${bvid}`;
    if (media.aid) return `https://www.bilibili.com/video/av${media.aid}`;

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

  async function signWbiParams(params, logger) {
    const keys = await getWbiKeys(logger);
    const mixinKey = getMixinKey(keys.imgKey + keys.subKey);
    const signedParams = {
      ...params,
      wts: Math.round(Date.now() / 1000)
    };
    const query = Object.keys(signedParams)
      .sort()
      .map((key) => {
        const value = String(signedParams[key] ?? "").replace(/[!'()*]/g, "");
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      })
      .join("&");
    return `${query}&w_rid=${md5(query + mixinKey)}`;
  }

  async function getWbiKeys(logger) {
    if (wbiKeyCache && Date.now() - wbiKeyCache.createdAt < 12 * 60 * 60 * 1000) {
      return wbiKeyCache;
    }

    const data = await fetchJson(API.nav, logger, 1);
    const imgUrl = data.wbi_img?.img_url || "";
    const subUrl = data.wbi_img?.sub_url || "";
    const imgKey = extractWbiKey(imgUrl);
    const subKey = extractWbiKey(subUrl);
    if (!imgKey || !subKey) {
      throw new Error("B 站 WBI 签名密钥读取失败，请确认已打开并登录 B 站后重试");
    }

    wbiKeyCache = { imgKey, subKey, createdAt: Date.now() };
    return wbiKeyCache;
  }

  function extractWbiKey(url) {
    const filename = String(url || "").split("/").pop() || "";
    return filename.split(".")[0] || "";
  }

  function getMixinKey(rawKey) {
    return MIXIN_KEY_ENC_TAB.map((index) => rawKey[index] || "").join("").slice(0, 32);
  }

  function md5(input) {
    function rotateLeft(value, shift) {
      return (value << shift) | (value >>> (32 - shift));
    }

    function addUnsigned(left, right) {
      const left4 = left & 0x40000000;
      const right4 = right & 0x40000000;
      const left8 = left & 0x80000000;
      const right8 = right & 0x80000000;
      const result = (left & 0x3fffffff) + (right & 0x3fffffff);
      if (left4 & right4) return result ^ 0x80000000 ^ left8 ^ right8;
      if (left4 | right4) return result & 0x40000000 ? result ^ 0xc0000000 ^ left8 ^ right8 : result ^ 0x40000000 ^ left8 ^ right8;
      return result ^ left8 ^ right8;
    }

    function f(x, y, z) {
      return (x & y) | (~x & z);
    }

    function g(x, y, z) {
      return (x & z) | (y & ~z);
    }

    function h(x, y, z) {
      return x ^ y ^ z;
    }

    function i(x, y, z) {
      return y ^ (x | ~z);
    }

    function transform(fn, a, b, c, d, x, s, ac) {
      return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, fn(b, c, d)), addUnsigned(x, ac)), s), b);
    }

    function utf8Encode(value) {
      return unescape(encodeURIComponent(value));
    }

    function toWordArray(value) {
      const length = value.length;
      const wordCount = (((length + 8) - ((length + 8) % 64)) / 64 + 1) * 16;
      const words = Array(wordCount - 1).fill(0);
      let bytePosition = 0;
      let byteCount = 0;

      while (byteCount < length) {
        const wordIndex = (byteCount - (byteCount % 4)) / 4;
        bytePosition = (byteCount % 4) * 8;
        words[wordIndex] = words[wordIndex] | (value.charCodeAt(byteCount) << bytePosition);
        byteCount += 1;
      }

      const wordIndex = (byteCount - (byteCount % 4)) / 4;
      bytePosition = (byteCount % 4) * 8;
      words[wordIndex] = words[wordIndex] | (0x80 << bytePosition);
      words[wordCount - 2] = length << 3;
      words[wordCount - 1] = length >>> 29;
      return words;
    }

    function wordToHex(value) {
      let output = "";
      for (let count = 0; count <= 3; count += 1) {
        output += (`0${((value >>> (count * 8)) & 255).toString(16)}`).slice(-2);
      }
      return output;
    }

    const words = toWordArray(utf8Encode(String(input)));
    let a = 0x67452301;
    let b = 0xefcdab89;
    let c = 0x98badcfe;
    let d = 0x10325476;

    for (let k = 0; k < words.length; k += 16) {
      const aa = a;
      const bb = b;
      const cc = c;
      const dd = d;

      a = transform(f, a, b, c, d, words[k + 0], 7, 0xd76aa478);
      d = transform(f, d, a, b, c, words[k + 1], 12, 0xe8c7b756);
      c = transform(f, c, d, a, b, words[k + 2], 17, 0x242070db);
      b = transform(f, b, c, d, a, words[k + 3], 22, 0xc1bdceee);
      a = transform(f, a, b, c, d, words[k + 4], 7, 0xf57c0faf);
      d = transform(f, d, a, b, c, words[k + 5], 12, 0x4787c62a);
      c = transform(f, c, d, a, b, words[k + 6], 17, 0xa8304613);
      b = transform(f, b, c, d, a, words[k + 7], 22, 0xfd469501);
      a = transform(f, a, b, c, d, words[k + 8], 7, 0x698098d8);
      d = transform(f, d, a, b, c, words[k + 9], 12, 0x8b44f7af);
      c = transform(f, c, d, a, b, words[k + 10], 17, 0xffff5bb1);
      b = transform(f, b, c, d, a, words[k + 11], 22, 0x895cd7be);
      a = transform(f, a, b, c, d, words[k + 12], 7, 0x6b901122);
      d = transform(f, d, a, b, c, words[k + 13], 12, 0xfd987193);
      c = transform(f, c, d, a, b, words[k + 14], 17, 0xa679438e);
      b = transform(f, b, c, d, a, words[k + 15], 22, 0x49b40821);

      a = transform(g, a, b, c, d, words[k + 1], 5, 0xf61e2562);
      d = transform(g, d, a, b, c, words[k + 6], 9, 0xc040b340);
      c = transform(g, c, d, a, b, words[k + 11], 14, 0x265e5a51);
      b = transform(g, b, c, d, a, words[k + 0], 20, 0xe9b6c7aa);
      a = transform(g, a, b, c, d, words[k + 5], 5, 0xd62f105d);
      d = transform(g, d, a, b, c, words[k + 10], 9, 0x02441453);
      c = transform(g, c, d, a, b, words[k + 15], 14, 0xd8a1e681);
      b = transform(g, b, c, d, a, words[k + 4], 20, 0xe7d3fbc8);
      a = transform(g, a, b, c, d, words[k + 9], 5, 0x21e1cde6);
      d = transform(g, d, a, b, c, words[k + 14], 9, 0xc33707d6);
      c = transform(g, c, d, a, b, words[k + 3], 14, 0xf4d50d87);
      b = transform(g, b, c, d, a, words[k + 8], 20, 0x455a14ed);
      a = transform(g, a, b, c, d, words[k + 13], 5, 0xa9e3e905);
      d = transform(g, d, a, b, c, words[k + 2], 9, 0xfcefa3f8);
      c = transform(g, c, d, a, b, words[k + 7], 14, 0x676f02d9);
      b = transform(g, b, c, d, a, words[k + 12], 20, 0x8d2a4c8a);

      a = transform(h, a, b, c, d, words[k + 5], 4, 0xfffa3942);
      d = transform(h, d, a, b, c, words[k + 8], 11, 0x8771f681);
      c = transform(h, c, d, a, b, words[k + 11], 16, 0x6d9d6122);
      b = transform(h, b, c, d, a, words[k + 14], 23, 0xfde5380c);
      a = transform(h, a, b, c, d, words[k + 1], 4, 0xa4beea44);
      d = transform(h, d, a, b, c, words[k + 4], 11, 0x4bdecfa9);
      c = transform(h, c, d, a, b, words[k + 7], 16, 0xf6bb4b60);
      b = transform(h, b, c, d, a, words[k + 10], 23, 0xbebfbc70);
      a = transform(h, a, b, c, d, words[k + 13], 4, 0x289b7ec6);
      d = transform(h, d, a, b, c, words[k + 0], 11, 0xeaa127fa);
      c = transform(h, c, d, a, b, words[k + 3], 16, 0xd4ef3085);
      b = transform(h, b, c, d, a, words[k + 6], 23, 0x04881d05);
      a = transform(h, a, b, c, d, words[k + 9], 4, 0xd9d4d039);
      d = transform(h, d, a, b, c, words[k + 12], 11, 0xe6db99e5);
      c = transform(h, c, d, a, b, words[k + 15], 16, 0x1fa27cf8);
      b = transform(h, b, c, d, a, words[k + 2], 23, 0xc4ac5665);

      a = transform(i, a, b, c, d, words[k + 0], 6, 0xf4292244);
      d = transform(i, d, a, b, c, words[k + 7], 10, 0x432aff97);
      c = transform(i, c, d, a, b, words[k + 14], 15, 0xab9423a7);
      b = transform(i, b, c, d, a, words[k + 5], 21, 0xfc93a039);
      a = transform(i, a, b, c, d, words[k + 12], 6, 0x655b59c3);
      d = transform(i, d, a, b, c, words[k + 3], 10, 0x8f0ccc92);
      c = transform(i, c, d, a, b, words[k + 10], 15, 0xffeff47d);
      b = transform(i, b, c, d, a, words[k + 1], 21, 0x85845dd1);
      a = transform(i, a, b, c, d, words[k + 8], 6, 0x6fa87e4f);
      d = transform(i, d, a, b, c, words[k + 15], 10, 0xfe2ce6e0);
      c = transform(i, c, d, a, b, words[k + 6], 15, 0xa3014314);
      b = transform(i, b, c, d, a, words[k + 13], 21, 0x4e0811a1);
      a = transform(i, a, b, c, d, words[k + 4], 6, 0xf7537e82);
      d = transform(i, d, a, b, c, words[k + 11], 10, 0xbd3af235);
      c = transform(i, c, d, a, b, words[k + 2], 15, 0x2ad7d2bb);
      b = transform(i, b, c, d, a, words[k + 9], 21, 0xeb86d391);

      a = addUnsigned(a, aa);
      b = addUnsigned(b, bb);
      c = addUnsigned(c, cc);
      d = addUnsigned(d, dd);
    }

    return `${wordToHex(a)}${wordToHex(b)}${wordToHex(c)}${wordToHex(d)}`;
  }

  function describeTimeFilter(filter) {
    if (!filter || filter.type === "all") return "全部";
    if (filter.type === "last7") return "最近 7 天";
    if (filter.type === "last30") return "最近 30 天";
    if (filter.type === "last180") return "半年内";
    if (filter.type === "last365") return "一年内";
    if (filter.type === "custom") return `${filter.startDate || "不限"} 至 ${filter.endDate || "不限"}`;
    return "全部";
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  globalScope.FavExportBilibili = {
    getLoginState,
    getFolders,
    getUpArchiveOverview,
    exportFolders,
    exportUpArchives
  };
})(globalThis);
