(function attachExcelExporter(globalScope) {
  const COLUMNS = [
    "platform",
    "folder_name",
    "title",
    "url",
    "cover_url",
    "cover_image",
    "author",
    "author_follower_count",
    "author_video_count",
    "author_url",
    "description",
    "video_tags",
    "view_count",
    "like_count",
    "favorite_count",
    "coin_count",
    "share_count",
    "comment_count",
    "danmaku_count",
    "duration",
    "subtitle_text",
    "favorite_time",
    "publish_time",
    "status",
    "content_type",
    "tags",
    "notes",
    "exported_at"
  ];

  function rowsToSheet(rows) {
    const data = rows.length ? rows : [Object.fromEntries(COLUMNS.map((column) => [column, ""]))];
    const sheet = XLSX.utils.json_to_sheet(data, { header: COLUMNS });
    sheet["!cols"] = COLUMNS.map((column) => {
      if (column === "cover_image") return { wch: 18 };
      return {
        wch: Math.max(
          column.length + 2,
          ...data.map((row) => String(row[column] ?? "").length).map((length) => Math.min(length + 2, 48))
        )
      };
    });
    sheet["!rows"] = [{ hpt: 20 }, ...data.map((row) => (row.cover_image ? { hpt: 72 } : { hpt: 20 }))];
    addHyperlinks(sheet, data);
    addCoverImageFormulas(sheet, data);
    return sheet;
  }

  function addHyperlinks(sheet, rows) {
    const urlColumnIndexes = {
      url: COLUMNS.indexOf("url"),
      cover_url: COLUMNS.indexOf("cover_url"),
      author_url: COLUMNS.indexOf("author_url")
    };

    rows.forEach((row, rowIndex) => {
      Object.entries(urlColumnIndexes).forEach(([field, columnIndex]) => {
        const value = row[field];
        if (!value) return;
        const cellRef = XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex });
        if (!sheet[cellRef]) return;
        sheet[cellRef].l = { Target: value };
      });
    });
  }

  function addCoverImageFormulas(sheet, rows) {
    const columnIndex = COLUMNS.indexOf("cover_image");
    if (columnIndex < 0) return;

    rows.forEach((row, rowIndex) => {
      const imageUrl = row.cover_image || row.cover_url;
      if (!imageUrl) return;

      const cellRef = XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex });
      sheet[cellRef] = {
        t: "s",
        f: `IMAGE("${escapeFormulaString(imageUrl)}")`,
        v: "封面预览"
      };
    });
  }

  function escapeFormulaString(value) {
    return String(value || "").replaceAll('"', '""');
  }

  function buildSummaryRows(summary) {
    return [
      { key: "平台", value: summary.platformLabel || "" },
      { key: "收藏夹名称", value: (summary.folderNames || []).join(", ") },
      { key: "筛选时间范围", value: summary.timeRangeText || "全部" },
      { key: "导出总数", value: summary.totalCount || 0 },
      { key: "成功数量", value: summary.successCount || 0 },
      { key: "失效数量", value: summary.invalidCount || 0 },
      { key: "失败数量", value: summary.failedCount || 0 },
      { key: "说明", value: summary.description || "" },
      { key: "导出时间", value: globalScope.FavExportDate.formatDateTime(new Date()) }
    ];
  }

  function createWorkbook({ items, invalidItems, errors, summary }) {
    const normalRows = items.map(globalScope.FavExportNormalize.normalizeFavoriteItem);
    const invalidRows = invalidItems.map(globalScope.FavExportNormalize.normalizeFavoriteItem);
    const errorRows = (errors || []).map((entry) => ({
      time: entry.time || "",
      level: entry.level || "error",
      message: entry.message || "",
      detail: entry.detail || ""
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, rowsToSheet(normalRows), "收藏内容");
    XLSX.utils.book_append_sheet(workbook, rowsToSheet(invalidRows), "失效内容");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(buildSummaryRows(summary)), "导出说明");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(errorRows.length ? errorRows : [{ time: "", level: "", message: "", detail: "" }]), "错误日志");

    return workbook;
  }

  function buildFilename(platformLabel) {
    const date = globalScope.FavExportDate.formatDateForFile(new Date());
    return `收藏夹导出_${platformLabel}_${date}.xlsx`;
  }

  function workbookToDataUrl(workbook) {
    const base64 = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "base64",
      cellStyles: true
    });
    return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
  }

  globalScope.FavExportExcel = {
    createWorkbook,
    buildFilename,
    workbookToDataUrl
  };
})(globalThis);
