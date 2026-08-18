import axios from "axios";
import { getConfig } from "./config.js";

/**
 * "Olka Roadmap" raporu:
 * Hebiar (Commercelab) Jira'sındaki OLK projesinin roadmap tamamlanma durumunu,
 * tasklardaki AY etiketlerine (label) göre çıkarır. Her maddenin roadmap ayı,
 * label'ındaki Türkçe ay adından (Ocak..Aralık, opsiyonel yıl ön ekiyle: 2026Haziran)
 * belirlenir. Frontend haftalık/aylık/yıllık/özel tarih aralığı filtresini bu ay
 * bilgisine göre uygular.
 *
 * Not: Hebiar sabit URL'dir; config.baseUrl Olka'yı gösterse bile bu rapor daima
 * Hebiar'a bağlanır (HEBIAR_BASE_URL ile override edilebilir).
 */

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");

const ROADMAP_PROJECT = process.env.OLKA_ROADMAP_PROJECT || "OLK";

// Tamamlanmış sayılan statüler (küçük harf). Bunlara ek olarak "Tamamlandı" (Done)
// kategorisindeki her statü de tamamlanmış kabul edilir (Onlive, Tamam vb.).
const COMPLETED_STATUSES = new Set(
  (
    process.env.OLKA_ROADMAP_COMPLETED_STATUSES ||
    "ready for release,merge,merged,qa testing,test"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

// Roadmap dışı sayılan (iptal/silinmiş) statüler — toplam ve orandan hariç tutulur.
const EXCLUDED_STATUSES = new Set(
  (process.env.OLKA_ROADMAP_EXCLUDED_STATUSES || "deleted")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

// Ay etiketi olmasa bile roadmap sayılan ekstra etiketler (küçük harf).
const STRATEGY_LABELS = new Set(
  (process.env.OLKA_ROADMAP_STRATEGY_LABELS || "2026ondemand,2026strategy")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

// Hebiar haftalık board (sprint listesi + sprint üyeliği buradan alınır).
const HEBIAR_WEEKLY_BOARD_ID = parseInt(
  process.env.HEBIAR_WEEKLY_BOARD_ID || "54",
  10,
);

// Jira "Sprint" custom field id (Hebiar).
const SPRINT_FIELD = process.env.HEBIAR_SPRINT_FIELD || "customfield_10020";

// Sprint listesinde gösterilecek en yeni kapanan sprint sayısı.
const CLOSED_SPRINT_LIMIT = parseInt(
  process.env.OLKA_ROADMAP_CLOSED_LIMIT || "40",
  10,
);

// Türkçe ay adları -> ay indeksi (1-12). Diakritikli ve diakritiksiz varyantlar.
const TR_MONTHS = [
  { idx: 1, tr: "Ocak", names: ["ocak"] },
  { idx: 2, tr: "Şubat", names: ["şubat", "subat"] },
  { idx: 3, tr: "Mart", names: ["mart"] },
  { idx: 4, tr: "Nisan", names: ["nisan"] },
  { idx: 5, tr: "Mayıs", names: ["mayıs", "mayis"] },
  { idx: 6, tr: "Haziran", names: ["haziran"] },
  { idx: 7, tr: "Temmuz", names: ["temmuz"] },
  { idx: 8, tr: "Ağustos", names: ["ağustos", "agustos"] },
  { idx: 9, tr: "Eylül", names: ["eylül", "eylul"] },
  { idx: 10, tr: "Ekim", names: ["ekim"] },
  { idx: 11, tr: "Kasım", names: ["kasım", "kasim"] },
  { idx: 12, tr: "Aralık", names: ["aralık", "aralik"] },
];

const MONTH_BY_NAME = new Map();
for (const m of TR_MONTHS) {
  for (const n of m.names) MONTH_BY_NAME.set(n, m);
}

const MONTH_LABEL_TR = (idx) => {
  const m = TR_MONTHS.find((x) => x.idx === idx);
  return m ? m.tr : String(idx);
};

// Kısa süreli önbellek (aynı dataset'i art arda çekmemek için).
const CACHE_TTL_MS = parseInt(process.env.OLKA_ROADMAP_CACHE_MS || "60000", 10);

class OlkaRoadmapReportService {
  constructor() {
    this._cache = null;
    this._cacheAt = 0;
  }

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

  /**
   * Enhanced JQL endpoint (/rest/api/3/search/jql) — nextPageToken sayfalama.
   */
  async _searchAllJql(jql, fields) {
    const headers = this.getAuthHeader();
    const all = [];
    let nextPageToken;
    let page = 0;

    do {
      const body = { jql, fields, maxResults: 100 };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const res = await axios.post(
        `${HEBIAR_BASE_URL}/rest/api/3/search/jql`,
        body,
        { headers, timeout: 60000 },
      );
      const issues = res.data.issues || [];
      all.push(...issues);
      nextPageToken = res.data.nextPageToken;
      page++;
      if (page > 100) break; // güvenlik
    } while (nextPageToken);

    return all;
  }

  /**
   * Tek bir label'ı ayrıştırır. Ay etiketi ise {monthIdx, year|null} döner,
   * değilse null. Örn: "Ağustos" -> {8, null}, "2026Haziran" -> {6, 2026},
   * "2026Roadmap" -> null (ay değil).
   */
  parseMonthLabel(label) {
    const lower = String(label || "")
      .trim()
      .toLowerCase();
    if (!lower) return null;

    let year = null;
    let rest = lower;
    const ym = lower.match(/^(20\d{2})[\s_-]?(.*)$/);
    if (ym) {
      year = parseInt(ym[1], 10);
      rest = ym[2];
    }
    const m = MONTH_BY_NAME.get(rest);
    if (!m) return null;
    return { monthIdx: m.idx, year };
  }

  _inferYear(monthIdx, fields, defaultYear) {
    if (fields.duedate) return new Date(fields.duedate).getFullYear();
    if (fields.resolutiondate)
      return new Date(fields.resolutiondate).getFullYear();
    if (fields.created) return new Date(fields.created).getFullYear();
    return defaultYear;
  }

  /**
   * Bir issue'nun tüm ay etiketlerinden roadmap kovasını (year+month) seçer.
   * Öncelik: yıl ön ekli etiketler, ardından en güncel (year, month).
   */
  _chooseBucket(labels, fields, defaultYear) {
    const parsed = (labels || [])
      .map((l) => this.parseMonthLabel(l))
      .filter(Boolean);
    if (!parsed.length) return null;

    const scored = parsed.map((p) => {
      const explicit = p.year != null;
      const year = explicit
        ? p.year
        : this._inferYear(p.monthIdx, fields, defaultYear);
      return { monthIdx: p.monthIdx, year, explicit };
    });

    scored.sort((a, b) => {
      if (a.explicit !== b.explicit) return a.explicit ? -1 : 1;
      return b.year * 12 + b.monthIdx - (a.year * 12 + a.monthIdx);
    });

    const c = scored[0];
    return { monthIdx: c.monthIdx, year: c.year };
  }

  isCompleted(statusName, statusCategoryKey) {
    const name = (statusName || "").trim().toLowerCase();
    return COMPLETED_STATUSES.has(name) || statusCategoryKey === "done";
  }

  isExcluded(statusName) {
    return EXCLUDED_STATUSES.has((statusName || "").trim().toLowerCase());
  }

  // Ay etiketi olmasa bile roadmap sayılan strateji etiketleri var mı?
  _hasStrategyLabel(labels) {
    return (labels || []).some((l) =>
      STRATEGY_LABELS.has(String(l).trim().toLowerCase()),
    );
  }

  // Sprint custom field'ından sprint bilgilerini çıkarır (obje veya eski string format).
  _parseSprints(val) {
    if (!Array.isArray(val)) return [];
    const out = [];
    for (const s of val) {
      if (s && typeof s === "object" && s.id != null) {
        out.push({
          id: Number(s.id),
          name: s.name || "",
          state: (s.state || "").toLowerCase(),
          startDate: s.startDate || null,
          endDate: s.endDate || null,
        });
      } else if (typeof s === "string") {
        const id = s.match(/id=(\d+)/);
        if (!id) continue;
        const state = s.match(/state=(\w+)/);
        const start = s.match(/startDate=([^,\]]+)/);
        const name = s.match(/name=([^,\]]+)/);
        out.push({
          id: Number(id[1]),
          name: name ? name[1] : "",
          state: state ? state[1].toLowerCase() : "",
          startDate: start && start[1] !== "<null>" ? start[1] : null,
          endDate: null,
        });
      }
    }
    return out;
  }

  // Ay etiketi olmayan roadmap maddeleri için kova: oluşturulma tarihinden türet.
  _bucketFromDate(dateStr, defaultYear) {
    const d = dateStr ? new Date(dateStr) : null;
    if (!d || isNaN(d.getTime())) return { monthIdx: 1, year: defaultYear };
    return { monthIdx: d.getMonth() + 1, year: d.getFullYear() };
  }

  _tsOf(s) {
    const d = s.completeDate || s.endDate || s.startDate;
    return d ? new Date(d).getTime() : 0;
  }

  async _fetchAllSprints(state) {
    const headers = this.getAuthHeader();
    let startAt = 0;
    let isLast = false;
    const all = [];
    while (!isLast) {
      const res = await axios.get(
        `${HEBIAR_BASE_URL}/rest/agile/1.0/board/${HEBIAR_WEEKLY_BOARD_ID}/sprint`,
        { params: { state, startAt, maxResults: 50 }, headers, timeout: 30000 },
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
   * Sprint seçim listesi: aktif > future > (en yeni) kapanan.
   * Sadece board 54'ten doğan (originBoardId===54) sprintler döner
   * (MC Sprint 1 sızıntısını önler).
   */
  async getSprints() {
    const raw = await this._fetchAllSprints("active,future,closed");
    const weekly = raw.filter(
      (s) => Number(s.originBoardId) === HEBIAR_WEEKLY_BOARD_ID,
    );
    const active = weekly
      .filter((s) => s.state === "active")
      .sort((a, b) => this._tsOf(b) - this._tsOf(a));
    const future = weekly
      .filter((s) => s.state === "future")
      .sort((a, b) => this._tsOf(a) - this._tsOf(b));
    const closed = weekly
      .filter((s) => s.state === "closed")
      .sort((a, b) => this._tsOf(b) - this._tsOf(a))
      .slice(0, CLOSED_SPRINT_LIMIT);
    return [...active, ...future, ...closed].map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
      startDate: s.startDate || null,
      endDate: s.endDate || null,
      completeDate: s.completeDate || null,
    }));
  }

  /**
   * OLK projesindeki ay-etiketli tüm maddeleri, hesaplanmış roadmap ayı +
   * tamamlanma bilgisiyle döner. Frontend dönem filtresini client-side uygular.
   */
  async getReport() {
    const now = Date.now();
    if (this._cache && now - this._cacheAt < CACHE_TTL_MS) {
      return this._cache;
    }

    const defaultYear = new Date().getFullYear();
    const jql = `project = ${ROADMAP_PROJECT} ORDER BY created DESC`;
    const issues = await this._searchAllJql(jql, [
      "summary",
      "labels",
      "status",
      "assignee",
      "priority",
      "issuetype",
      "resolutiondate",
      "duedate",
      "created",
      "updated",
      SPRINT_FIELD,
    ]);

    let sprints = [];
    try {
      sprints = await this.getSprints();
    } catch (e) {
      sprints = [];
    }

    const items = [];
    const monthMap = new Map(); // monthKey -> {year, month, count, completed}
    const yearsSet = new Set();
    let excludedCount = 0;

    for (const it of issues) {
      const f = it.fields || {};
      const labels = f.labels || [];
      const monthBucket = this._chooseBucket(labels, f, defaultYear);
      const hasStrategy = this._hasStrategyLabel(labels);
      const isRoadmap = !!monthBucket || hasStrategy;

      // Roadmap kovası: ay etiketi varsa ondan; yoksa (strateji etiketli madde)
      // oluşturulma tarihinden türetilir ki dönem görünümlerinde de yer alsın.
      const bucket =
        monthBucket ||
        (isRoadmap ? this._bucketFromDate(f.created, defaultYear) : null);

      const statusName = f.status ? f.status.name : "";
      const statusCategoryKey =
        f.status && f.status.statusCategory
          ? f.status.statusCategory.key
          : null;
      const excluded = this.isExcluded(statusName);
      const completed =
        !excluded && this.isCompleted(statusName, statusCategoryKey);

      const monthKey = bucket
        ? `${bucket.year}-${String(bucket.monthIdx).padStart(2, "0")}`
        : null;

      const row = {
        key: it.key,
        summary: f.summary || "",
        assignee: f.assignee ? f.assignee.displayName : "Atanmamış",
        status: statusName,
        statusCategory: statusCategoryKey,
        issueType: f.issuetype ? f.issuetype.name : "",
        priority: f.priority ? f.priority.name : "",
        labels,
        isRoadmap,
        year: bucket ? bucket.year : null,
        month: bucket ? bucket.monthIdx : null,
        monthKey,
        monthLabel: bucket
          ? `${MONTH_LABEL_TR(bucket.monthIdx)} ${bucket.year}`
          : null,
        completed,
        excluded,
        sprints: this._parseSprints(f[SPRINT_FIELD]),
        resolutiondate: f.resolutiondate || null,
        duedate: f.duedate || null,
        created: f.created || null,
        updated: f.updated || null,
      };
      items.push(row);

      // Aylık kırılım + yıl listesi YALNIZCA roadmap (ay-kovalı) maddelerden.
      if (isRoadmap && bucket) {
        yearsSet.add(bucket.year);
        if (!excluded) {
          const cur = monthMap.get(monthKey) || {
            monthKey,
            year: bucket.year,
            month: bucket.monthIdx,
            label: `${MONTH_LABEL_TR(bucket.monthIdx)} ${bucket.year}`,
            count: 0,
            completed: 0,
          };
          cur.count += 1;
          if (completed) cur.completed += 1;
          monthMap.set(monthKey, cur);
        } else {
          excludedCount += 1;
        }
      }
    }

    const months = [...monthMap.values()]
      .map((m) => ({
        ...m,
        remaining: m.count - m.completed,
        completionRate:
          m.count > 0 ? Math.round((m.completed / m.count) * 1000) / 10 : 0,
      }))
      .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));

    const years = [...yearsSet].sort((a, b) => a - b);

    const totalRoadmapItems = items.filter(
      (r) => r.isRoadmap && !r.excluded,
    ).length;
    const totalCompleted = items.filter(
      (r) => r.isRoadmap && !r.excluded && r.completed,
    ).length;

    const report = {
      project: ROADMAP_PROJECT,
      baseUrl: HEBIAR_BASE_URL,
      generatedAt: new Date().toISOString(),
      defaultYear,
      totalProjectItems: items.length,
      totalRoadmapItems,
      totalCompleted,
      totalRemaining: totalRoadmapItems - totalCompleted,
      completionRate:
        totalRoadmapItems > 0
          ? Math.round((totalCompleted / totalRoadmapItems) * 1000) / 10
          : 0,
      excludedCount,
      months,
      years,
      sprints,
      items,
      count: items.length,
    };

    this._cache = report;
    this._cacheAt = now;
    return report;
  }

  /**
   * Dönem filtreli roadmap raporunu şablonlu bir .xlsx dosyası olarak üretir.
   * data = { periodLabel, stats, monthBreakdown[], rows[] }
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
    const TOTAL_FILL = "FFEAF0FA";
    const GREEN = "FF1E7E4F";
    const RED = "FFB4232F";

    const baseUrl = (data.baseUrl || HEBIAR_BASE_URL).replace(/\/$/, "");
    const periodLabel = data.periodLabel || "—";
    const stats = data.stats || {};
    const total = stats.total || 0;
    const completed = stats.completed || 0;
    const remaining =
      stats.remaining != null ? stats.remaining : total - completed;
    const completionRate =
      stats.completionRate != null
        ? stats.completionRate
        : total > 0
          ? Math.round((completed / total) * 1000) / 10
          : 0;
    const monthBreakdown = Array.isArray(data.monthBreakdown)
      ? data.monthBreakdown
      : [];
    const rows = Array.isArray(data.rows) ? data.rows : [];

    // ---- Sheet 1: Özet ----
    const ws = workbook.addWorksheet("Özet", {
      pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1 },
    });
    ws.columns = [{ width: 30 }, { width: 14 }, { width: 14 }, { width: 16 }];

    ws.mergeCells("A1:D1");
    const t1 = ws.getCell("A1");
    t1.value = "Olka Roadmap Raporu";
    t1.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    t1.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    t1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    ws.getRow(1).height = 30;

    ws.mergeCells("A2:D2");
    const t2 = ws.getCell("A2");
    t2.value = `Dönem: ${periodLabel}      |      Oluşturulma: ${new Date().toLocaleString("tr-TR")}`;
    t2.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
    t2.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    t2.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: TOTAL_FILL },
    };
    ws.getRow(2).height = 18;

    // İstatistik tablosu
    const statRows = [
      ["Toplam Madde", total],
      ["Tamamlanan", completed],
      ["Kalan", remaining],
      ["Tamamlanma Oranı", `%${completionRate}`],
    ];
    let r = 4;
    statRows.forEach(([k, v], i) => {
      const c1 = ws.getCell(r, 1);
      c1.value = k;
      c1.font = { bold: true, size: 11 };
      c1.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      const c2 = ws.getCell(r, 2);
      c2.value = v;
      c2.font = {
        bold: true,
        size: 11,
        color: {
          argb: k === "Tamamlanan" ? GREEN : k === "Kalan" ? RED : "FF1F2937",
        },
      };
      c2.alignment = { vertical: "middle", horizontal: "center" };
      [c1, c2].forEach((c) => {
        if (i % 2 === 1)
          c.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: ZEBRA },
          };
        c.border = {
          top: { style: "thin", color: { argb: BORDER } },
          left: { style: "thin", color: { argb: BORDER } },
          bottom: { style: "thin", color: { argb: BORDER } },
          right: { style: "thin", color: { argb: BORDER } },
        };
      });
      ws.getRow(r).height = 18;
      r++;
    });

    // Aylık kırılım (varsa)
    if (monthBreakdown.length) {
      r += 1;
      ws.mergeCells(`A${r}:D${r}`);
      const mh = ws.getCell(r, 1);
      mh.value = "Aylık Kırılım";
      mh.font = { bold: true, size: 12, color: { argb: NAVY } };
      mh.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      ws.getRow(r).height = 20;
      r++;

      const mHeaders = ["Ay", "Toplam", "Tamamlanan", "Tamamlanma %"];
      mHeaders.forEach((h, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = h;
        cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: HEADER },
        };
        cell.alignment = {
          vertical: "middle",
          horizontal: i === 0 ? "left" : "center",
          indent: i === 0 ? 1 : 0,
        };
      });
      ws.getRow(r).height = 20;
      r++;

      monthBreakdown.forEach((m, idx) => {
        const cells = [m.label, m.total, m.completed, `%${m.completionRate}`];
        cells.forEach((v, i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = v;
          cell.font = { size: 11 };
          cell.alignment = {
            vertical: "middle",
            horizontal: i === 0 ? "left" : "center",
            indent: i === 0 ? 1 : 0,
          };
          if (idx % 2 === 1)
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: ZEBRA },
            };
          cell.border = {
            top: { style: "thin", color: { argb: BORDER } },
            left: { style: "thin", color: { argb: BORDER } },
            bottom: { style: "thin", color: { argb: BORDER } },
            right: { style: "thin", color: { argb: BORDER } },
          };
        });
        ws.getRow(r).height = 18;
        r++;
      });
    }

    // ---- Sheet 2: Maddeler ----
    const ws2 = workbook.addWorksheet("Maddeler", {
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });
    ws2.columns = [
      { width: 13 },
      { width: 60 },
      { width: 22 },
      { width: 16 },
      { width: 18 },
      { width: 14 },
    ];

    ws2.mergeCells("A1:F1");
    const h1 = ws2.getCell("A1");
    h1.value = `Roadmap Maddeleri — ${periodLabel}`;
    h1.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    h1.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    h1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    ws2.getRow(1).height = 26;

    const headers = [
      "Task No",
      "Task Adı",
      "Atanan Kişi",
      "Roadmap Ayı",
      "Statü",
      "Durum",
    ];
    const headerRowIdx = 3;
    headers.forEach((h, i) => {
      const cell = ws2.getCell(headerRowIdx, i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: HEADER },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: i === 1 ? "left" : "center",
        indent: i === 1 ? 1 : 0,
      };
    });
    ws2.getRow(headerRowIdx).height = 20;

    let rr = headerRowIdx + 1;
    rows.forEach((row, idx) => {
      const durum = row.completed ? "✔ Tamamlandı" : "⏳ Devam";
      const cells = [
        row.key,
        row.summary,
        row.assignee,
        row.monthLabel,
        row.status,
        durum,
      ];
      cells.forEach((v, i) => {
        const cell = ws2.getCell(rr, i + 1);
        cell.value = v;
        cell.font = { size: 10 };
        cell.alignment = {
          vertical: "middle",
          horizontal: i === 1 ? "left" : "center",
          indent: i === 1 ? 1 : 0,
          wrapText: i === 1,
        };
        if (idx % 2 === 1)
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: ZEBRA },
          };
        cell.border = {
          top: { style: "thin", color: { argb: BORDER } },
          left: { style: "thin", color: { argb: BORDER } },
          bottom: { style: "thin", color: { argb: BORDER } },
          right: { style: "thin", color: { argb: BORDER } },
        };
      });
      // Task No hyperlink
      const keyCell = ws2.getCell(rr, 1);
      keyCell.value = {
        text: row.key,
        hyperlink: `${baseUrl}/browse/${row.key}`,
      };
      keyCell.font = { size: 10, color: { argb: "FF2E5AAC" }, underline: true };
      // Durum renk
      const durumCell = ws2.getCell(rr, 6);
      durumCell.font = {
        size: 10,
        bold: true,
        color: { argb: row.completed ? GREEN : "FFB06A00" },
      };
      ws2.getRow(rr).height = 16;
      rr++;
    });

    ws2.autoFilter = {
      from: { row: headerRowIdx, column: 1 },
      to: { row: headerRowIdx, column: 6 },
    };
    ws2.views = [{ state: "frozen", ySplit: headerRowIdx }];

    return workbook.xlsx.writeBuffer();
  }
}

export default new OlkaRoadmapReportService();
