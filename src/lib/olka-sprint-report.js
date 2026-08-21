import axios from "axios";
import { getConfig } from "./config.js";

/**
 * "Sprint Raporu" raporu:
 * Hebiar (Commercelab) Jira'sındaki weekly board'un EN SON KAPANAN sprintini alır
 * ve o sprintteki OLK ve SKCH maddelerini üç gruba ayırarak listeler:
 *   - Tamamlananlar (Ready For Release, QA Testing, Test, Merge, Merged + "Tamamlandı"
 *     kategorisindeki tüm statüler: Onlive, Tamam vb.)
 *   - Bloke / Beklemede (Blocked, On Hold)
 *   - Kalanlar (diğer tüm statüler)
 * Ayrıca genel bir istatistik (toplam, tamamlanan, kalan, bloke, başarı yüzdesi) döner.
 *
 * Not: Hebiar sabit URL'dir; config.baseUrl Olka'yı gösterse bile bu rapor daima
 * Hebiar'a bağlanır (HEBIAR_BASE_URL ile override edilebilir).
 */

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const HEBIAR_WEEKLY_BOARD_ID = parseInt(
  process.env.HEBIAR_WEEKLY_BOARD_ID || "54",
  10,
);
const TARGET_PREFIXES = (process.env.OLKA_SPRINT_PREFIXES || "OLK,SKCH")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

// Tamamlandı sayılan statüler (küçük harf). Bunlara ek olarak "Tamamlandı" (Done)
// kategorisindeki her statü de tamamlanmış kabul edilir (Onlive, Tamam vb.).
const COMPLETED_STATUSES = new Set(
  (
    process.env.OLKA_SPRINT_COMPLETED_STATUSES ||
    "ready for release,qa testing,test,merge,merged"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

// Bloke / beklemede sayılan statüler (küçük harf).
const BLOCKED_STATUSES = new Set(
  (
    process.env.OLKA_SPRINT_BLOCKED_STATUSES ||
    "blocked,block,on hold,onhold,hold,beklemede,bloke,bekliyor"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

class OlkaSprintReportService {
  getAuthHeader() {
    const { email, apiToken } = getConfig();
    if (!email || !apiToken) {
      throw new Error(
        'Jira kimlik bilgileri eksik. Önce "jira config setup" komutunu çalıştırın.',
      );
    }
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    return {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  getHebiarBaseUrl() {
    return HEBIAR_BASE_URL;
  }

  /**
   * Weekly board'un tüm sprintlerini (sayfalı) çeker.
   */
  async _fetchAllSprints(state) {
    const headers = this.getAuthHeader();
    let startAt = 0;
    let isLast = false;
    const all = [];

    while (!isLast) {
      const res = await axios.get(
        `${HEBIAR_BASE_URL}/rest/agile/1.0/board/${HEBIAR_WEEKLY_BOARD_ID}/sprint`,
        {
          params: { state, startAt, maxResults: 50 },
          headers,
          timeout: 30000,
        },
      );
      const values = res.data.values || [];
      all.push(...values);

      if (values.length === 0) break;
      isLast =
        res.data.isLast !== undefined ? res.data.isLast : values.length < 50;
      startAt += values.length;
    }

    return all;
  }

  /**
   * Bir sprintteki tüm issue'ları (sayfalı) çeker.
   */
  async _fetchAllSprintIssues(sprintId, fields) {
    const headers = this.getAuthHeader();
    let startAt = 0;
    let total = Infinity;
    const all = [];

    while (startAt < total) {
      const res = await axios.get(
        `${HEBIAR_BASE_URL}/rest/agile/1.0/sprint/${sprintId}/issue`,
        {
          params: { startAt, maxResults: 100, fields: fields.join(",") },
          headers,
          timeout: 30000,
        },
      );
      const issues = res.data.issues || [];
      all.push(...issues);

      total = res.data.total !== undefined ? res.data.total : all.length;
      if (issues.length === 0) break;
      startAt += issues.length;
    }

    return all;
  }

  /**
   * Kapanan sprintleri en yeni önce olacak şekilde sıralar
   * (completeDate > endDate > startDate önceliğiyle).
   */
  _sortClosedByRecency(sprints) {
    const ts = (s) => {
      const d = s.completeDate || s.endDate || s.startDate;
      return d ? new Date(d).getTime() : 0;
    };
    return [...sprints].sort((a, b) => ts(b) - ts(a));
  }

  /**
   * Bir statüyü kategoriye ayırır: "completed" | "blocked" | "remaining".
   * Öncelik bloke/beklemede -> tamamlandı -> kalan.
   */
  classifyStatus(statusName, statusCategoryKey) {
    const name = (statusName || "").trim().toLowerCase();
    if (BLOCKED_STATUSES.has(name)) return "blocked";
    if (COMPLETED_STATUSES.has(name) || statusCategoryKey === "done") {
      return "completed";
    }
    return "remaining";
  }

  /**
   * Belirtilen (ya da en son kapanan) sprint için OLK + SKCH maddelerini
   * kategorilere ayırarak ve istatistikleriyle birlikte döner.
   */
  async getSprintReport(sprintId) {
    const closed = this._sortClosedByRecency(
      await this._fetchAllSprints("closed"),
    );

    const sprintList = closed.slice(0, 30).map((s) => ({
      id: s.id,
      name: s.name,
      startDate: s.startDate || null,
      endDate: s.endDate || null,
      completeDate: s.completeDate || null,
    }));

    let target = sprintId
      ? closed.find((s) => String(s.id) === String(sprintId))
      : closed[0];
    if (!target) target = closed[0];
    if (!target) return this._emptySprintReport(sprintList);
    const issues = await this._fetchAllSprintIssues(target.id, [
      "summary",
      "status",
      "assignee",
      "issuetype",
    ]);
    const rows = issues
      .map((issue) => this._mapSprintIssue(issue))
      .filter(Boolean);
    rows.sort(
      (a, b) =>
        a.project.localeCompare(b.project) ||
        a.key.localeCompare(b.key, undefined, { numeric: true }),
    );
    return this._buildSprintReport(target, sprintList, rows);
  }

  _emptySprintReport(sprints) {
    return {
      sprint: null,
      sprints,
      rows: [],
      completed: [],
      remaining: [],
      blocked: [],
      stats: {
        total: 0,
        completed: 0,
        remaining: 0,
        blocked: 0,
        successRate: 0,
      },
      perProject: {},
      prefixes: TARGET_PREFIXES,
      count: 0,
    };
  }

  _mapSprintIssue(issue) {
    const key = issue.key || "";
    const project = key.split("-")[0].toUpperCase();
    if (!TARGET_PREFIXES.includes(project)) return null;
    const fields = issue.fields || {};
    const statusName = fields.status ? fields.status.name : "";
    const statusCategory = fields.status?.statusCategory;
    return {
      key,
      project,
      summary: fields.summary || "",
      assignee: fields.assignee ? fields.assignee.displayName : null,
      issueType: fields.issuetype ? fields.issuetype.name : null,
      status: statusName,
      statusCategory: statusCategory ? statusCategory.key : null,
      statusCategoryName: statusCategory ? statusCategory.name : null,
      category: this.classifyStatus(
        statusName,
        statusCategory ? statusCategory.key : null,
      ),
    };
  }

  _buildSprintReport(target, sprintList, rows) {
    const completed = rows.filter((r) => r.category === "completed");
    const remaining = rows.filter((r) => r.category === "remaining");
    const blocked = rows.filter((r) => r.category === "blocked");
    const total = rows.length;
    const successRate =
      total > 0 ? Math.round((completed.length / total) * 1000) / 10 : 0;
    const perProject = {};
    for (const project of TARGET_PREFIXES) {
      const subset = rows.filter((row) => row.project === project);
      perProject[project] = {
        total: subset.length,
        completed: subset.filter((row) => row.category === "completed").length,
        remaining: subset.filter((row) => row.category === "remaining").length,
        blocked: subset.filter((row) => row.category === "blocked").length,
      };
    }
    return {
      sprint: {
        id: target.id,
        name: target.name,
        startDate: target.startDate || null,
        endDate: target.endDate || null,
        completeDate: target.completeDate || null,
        state: "closed",
      },
      sprints: sprintList,
      rows,
      completed,
      remaining,
      blocked,
      stats: {
        total,
        completed: completed.length,
        remaining: remaining.length,
        blocked: blocked.length,
        successRate,
      },
      perProject,
      prefixes: TARGET_PREFIXES,
      completedStatuses: [...COMPLETED_STATUSES],
      blockedStatuses: [...BLOCKED_STATUSES],
      count: total,
    };
  }

  /**
   * Raporu şablonlu (renkli başlık, istatistik tablosu, kategori renkleri) bir
   * .xlsx dosyası olarak üretir ve Buffer döner. Türkçe karakterler desteklenir.
   */
  async buildXlsxBuffer(data = {}) {
    const ExcelJS = (await import("exceljs")).default;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PolatAi Dashboard";
    workbook.created = new Date();

    const NAVY = "FF1F3A5F";
    const HEADER = "FF2E5AAC";
    const ZEBRA = "FFF3F6FB";
    const BORDER = "FFD5DDE8";
    const GREEN_FILL = "FFE6F4EA";
    const GREEN_TEXT = "FF1E7E34";
    const AMBER_FILL = "FFFFF4E5";
    const AMBER_TEXT = "FFB26A00";
    const RED_FILL = "FFFCE4E6";
    const RED_TEXT = "FFC0182B";

    const stats = data.stats || {
      total: 0,
      completed: 0,
      remaining: 0,
      blocked: 0,
      successRate: 0,
    };
    const sprintName = data.sprint ? data.sprint.name : "—";

    // ---------------- Sheet 1: Özet ----------------
    const sum = workbook.addWorksheet("Özet", {
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });
    sum.columns = [
      { width: 28 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
    ];

    sum.mergeCells("A1:E1");
    const t1 = sum.getCell("A1");
    t1.value = "Sprint Raporu — Özet";
    t1.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    t1.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    t1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    sum.getRow(1).height = 30;

    sum.mergeCells("A2:E2");
    const t2 = sum.getCell("A2");
    t2.value = `Sprint: ${sprintName}      |      Projeler: ${(data.prefixes || []).join(", ")}      |      Oluşturulma: ${new Date().toLocaleString("tr-TR")}`;
    t2.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
    t2.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    t2.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEAF0FA" },
    };
    sum.getRow(2).height = 18;

    // İstatistik tablosu (etiket / değer)
    const statRows = [
      ["Toplam Madde", stats.total, null],
      ["Tamamlandı", stats.completed, GREEN_TEXT],
      ["Kalan", stats.remaining, AMBER_TEXT],
      ["Bloke / Beklemede", stats.blocked, RED_TEXT],
      ["Başarı Yüzdesi", `%${stats.successRate}`, GREEN_TEXT],
    ];
    let r = 4;
    statRows.forEach(([label, value, color]) => {
      const lc = sum.getCell(`A${r}`);
      lc.value = label;
      lc.font = { bold: true, size: 12 };
      lc.alignment = { vertical: "middle", indent: 1 };
      lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };

      const vc = sum.getCell(`B${r}`);
      vc.value = value;
      vc.font = {
        bold: true,
        size: 12,
        color: { argb: color || "FF1F2937" },
      };
      vc.alignment = { vertical: "middle", horizontal: "center" };

      for (const col of ["A", "B"]) {
        sum.getCell(`${col}${r}`).border = {
          top: { style: "thin", color: { argb: BORDER } },
          left: { style: "thin", color: { argb: BORDER } },
          bottom: { style: "thin", color: { argb: BORDER } },
          right: { style: "thin", color: { argb: BORDER } },
        };
      }
      sum.getRow(r).height = 20;
      r++;
    });

    // Proje bazlı kırılım tablosu
    r += 1;
    sum.mergeCells(`A${r}:E${r}`);
    const brkTitle = sum.getCell(`A${r}`);
    brkTitle.value = "Proje Bazlı Kırılım";
    brkTitle.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    brkTitle.alignment = { vertical: "middle", indent: 1 };
    brkTitle.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER },
    };
    sum.getRow(r).height = 22;
    r++;

    const brkHeaders = ["Proje", "Toplam", "Tamamlandı", "Kalan", "Bloke"];
    brkHeaders.forEach((h, i) => {
      const cell = sum.getCell(r, i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: HEADER },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    sum.getRow(r).height = 20;
    r++;

    const perProject = data.perProject || {};
    Object.entries(perProject).forEach(([proj, s]) => {
      sum.getCell(r, 1).value = proj;
      sum.getCell(r, 2).value = s.total;
      sum.getCell(r, 3).value = s.completed;
      sum.getCell(r, 4).value = s.remaining;
      sum.getCell(r, 5).value = s.blocked;
      for (let c = 1; c <= 5; c++) {
        const cell = sum.getCell(r, c);
        cell.alignment = {
          vertical: "middle",
          horizontal: c === 1 ? "left" : "center",
        };
        cell.border = {
          top: { style: "hair", color: { argb: BORDER } },
          left: { style: "hair", color: { argb: BORDER } },
          bottom: { style: "hair", color: { argb: BORDER } },
          right: { style: "hair", color: { argb: BORDER } },
        };
      }
      if (r % 2 === 0) {
        for (let c = 1; c <= 5; c++) {
          sum.getCell(r, c).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: ZEBRA },
          };
        }
      }
      sum.getRow(r).height = 18;
      r++;
    });

    // ---------------- Sheet 2: Maddeler ----------------
    const ws = workbook.addWorksheet("Maddeler", {
      views: [{ state: "frozen", ySplit: 3 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    const columns = [
      { header: "Proje", key: "project", width: 10 },
      { header: "Task No", key: "key", width: 15 },
      { header: "Task Adı", key: "summary", width: 60 },
      { header: "Atanan Kişi", key: "assignee", width: 24 },
      { header: "Statü", key: "status", width: 22 },
      { header: "Durum", key: "durum", width: 18 },
    ];
    ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));
    const COL_COUNT = columns.length;
    const LAST_COL = "F";

    ws.mergeCells(`A1:${LAST_COL}1`);
    const mt = ws.getCell("A1");
    mt.value = `Sprint Raporu — ${sprintName}`;
    mt.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    mt.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    mt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    ws.getRow(1).height = 30;

    ws.mergeCells(`A2:${LAST_COL}2`);
    const ms = ws.getCell("A2");
    ms.value = `Toplam: ${stats.total}   |   Tamamlandı: ${stats.completed}   |   Kalan: ${stats.remaining}   |   Bloke/Beklemede: ${stats.blocked}   |   Başarı: %${stats.successRate}`;
    ms.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
    ms.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ms.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEAF0FA" },
    };
    ws.getRow(2).height = 18;

    const headerRow = ws.getRow(3);
    columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: HEADER },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: "center",
        wrapText: true,
      };
      cell.border = {
        top: { style: "thin", color: { argb: BORDER } },
        left: { style: "thin", color: { argb: BORDER } },
        bottom: { style: "medium", color: { argb: NAVY } },
        right: { style: "thin", color: { argb: BORDER } },
      };
    });
    headerRow.height = 24;

    const durumLabel = {
      completed: "Tamamlandı",
      remaining: "Kalan",
      blocked: "Bloke/Beklemede",
    };
    const catFill = {
      completed: GREEN_FILL,
      remaining: AMBER_FILL,
      blocked: RED_FILL,
    };
    const catText = {
      completed: GREEN_TEXT,
      remaining: AMBER_TEXT,
      blocked: RED_TEXT,
    };

    // Tamamlanan -> Kalan -> Bloke sırasıyla yaz
    const ordered = [
      ...(data.completed || []),
      ...(data.remaining || []),
      ...(data.blocked || []),
    ];

    let rowIdx = 4;
    ordered.forEach((row) => {
      const line = ws.getRow(rowIdx);

      line.getCell(1).value = row.project || "";

      const c2 = line.getCell(2);
      c2.value = row.key
        ? { text: row.key, hyperlink: `${HEBIAR_BASE_URL}/browse/${row.key}` }
        : "";
      c2.font = { color: { argb: "FF1155CC" }, underline: true, bold: true };

      line.getCell(3).value = row.summary || "";

      const c4 = line.getCell(4);
      c4.value = row.assignee || "Atanmamış";
      if (!row.assignee)
        c4.font = { color: { argb: "FFAAAAAA" }, italic: true };

      line.getCell(5).value = row.status || "";

      const c6 = line.getCell(6);
      c6.value = durumLabel[row.category] || row.category;
      c6.font = { bold: true, color: { argb: catText[row.category] } };

      for (let col = 1; col <= COL_COUNT; col++) {
        const cell = line.getCell(col);
        cell.border = {
          top: { style: "hair", color: { argb: BORDER } },
          left: { style: "hair", color: { argb: BORDER } },
          bottom: { style: "hair", color: { argb: BORDER } },
          right: { style: "hair", color: { argb: BORDER } },
        };
        cell.alignment = {
          vertical: "middle",
          horizontal: col === 3 ? "left" : "center",
          wrapText: col === 3,
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: catFill[row.category] },
        };
      }

      line.height = 18;
      rowIdx++;
    });

    ws.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: 3, column: COL_COUNT },
    };

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

export default new OlkaSprintReportService();
