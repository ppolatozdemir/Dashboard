import axios from "axios";
import { getConfig } from "./config.js";

/**
 * "RFR Takip" (Ready For Release) raporu:
 * Hebiar (Commercelab) Jira'sında statüsü "Ready For Release" olan taskları,
 * atanan kişi bazında listeler. Her task için taskın bu statüye ne zaman geçtiği
 * (son statü güncelleme tarihi) changelog'dan bulunur ve kaç gündür RFR'de beklediği
 * hesaplanır. 1 ayı (varsayılan 30 gün) geçen tasklar "gecikmiş" olarak işaretlenir.
 *
 * Not: Hebiar sabit URL'dir; config.baseUrl Olka'yı gösterse bile bu rapor daima
 * Hebiar'a bağlanır (HEBIAR_BASE_URL ile override edilebilir).
 */

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const RFR_STATUS = process.env.RFR_STATUS || "Ready For Release";
const OVERDUE_DAYS = parseInt(process.env.RFR_OVERDUE_DAYS || "30", 10);
const DAY_MS = 24 * 60 * 60 * 1000;

export class RfrReportService {
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
   * Yeni "Enhanced JQL" search endpoint'i ile bir sorgunun tüm sonuçlarını
   * (nextPageToken ile sayfalı) çeker. Bu endpoint maxResults'ı yok sayıp ~100
   * kayıt/sayfa döner; bu yüzden isLast olana kadar tüm sayfalar toplanır.
   */
  async _searchAllJql(jql, fields) {
    const headers = this.getAuthHeader();
    let nextPageToken = null;
    let pages = 0;
    const all = [];

    do {
      const params = { jql, fields: fields.join(","), maxResults: 100 };
      if (nextPageToken) params.nextPageToken = nextPageToken;

      const res = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/search/jql`, {
        params,
        headers,
      });

      all.push(...(res.data.issues || []));
      nextPageToken = res.data.isLast ? null : res.data.nextPageToken || null;
      pages++;
    } while (nextPageToken && pages < 50);

    return all;
  }

  /**
   * Bir taskın tüm changelog kayıtlarını (statü geçiş geçmişi dahil) çeker.
   * startAt tabanlı sayfalama; çoğu task için tek sayfa yeter.
   */
  async _fetchIssueChangelog(issueKey) {
    const headers = this.getAuthHeader();
    const all = [];
    let startAt = 0;
    const maxResults = 100;

    for (let page = 0; page < 20; page++) {
      const res = await axios.get(
        `${HEBIAR_BASE_URL}/rest/api/3/issue/${encodeURIComponent(
          issueKey,
        )}/changelog`,
        { params: { startAt, maxResults }, headers },
      );

      const values = res.data.values || [];
      all.push(...values);

      const total = res.data.total ?? all.length;
      if (res.data.isLast || values.length === 0 || all.length >= total) break;
      startAt += values.length;
    }

    return all;
  }

  /**
   * Changelog geçmişinden taskın MEVCUT statüsüne (RFR) en son ne zaman geçtiğini
   * bulur. Öncelik: mevcut statüye yapılan son geçiş; yoksa herhangi bir son statü
   * değişimi; o da yoksa statuscategorychangedate / created'e düşer.
   */
  _computeRfrSince(histories, currentStatusName, fallback) {
    const target = (currentStatusName || "").trim().toLowerCase();
    const hasStatusItem = (h) =>
      (h.items || []).some((it) => it.field === "status");
    const isIntoCurrent = (h) =>
      (h.items || []).some(
        (it) =>
          it.field === "status" &&
          (it.toString || "").trim().toLowerCase() === target,
      );
    const latest = (arr) =>
      arr.reduce(
        (m, h) =>
          !m || new Date(h.created).getTime() > new Date(m.created).getTime()
            ? h
            : m,
        null,
      );

    const statusChanges = histories.filter(hasStatusItem);
    const intoCurrent = statusChanges.filter(isIntoCurrent);

    const chosen = intoCurrent.length
      ? latest(intoCurrent)
      : statusChanges.length
        ? latest(statusChanges)
        : null;

    if (chosen) return chosen.created;
    return fallback.statusCategoryChangeDate || fallback.created || null;
  }

  /**
   * items dizisini sınırlı eşzamanlılıkla (limit) işler. changelog istekleri
   * task sayısı kadar olduğundan sıralı gitmemek için basit bir worker havuzu.
   */
  async _mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let idx = 0;
    const size = Math.max(1, Math.min(limit, items.length));

    const worker = async () => {
      while (idx < items.length) {
        const cur = idx++;
        results[cur] = await fn(items[cur], cur);
      }
    };

    await Promise.all(Array.from({ length: size }, worker));
    return results;
  }

  /**
   * Statüsü "Ready For Release" olan Hebiar tasklarını, kişi bazlı özet ve
   * her task için RFR'de geçen gün sayısıyla birlikte döner.
   */
  async getRfrTasks(projectKeys = []) {
    const allowedProjectKeys = [
      ...new Set(
        projectKeys
          .map((key) => String(key || "").trim().toUpperCase())
          .filter(Boolean),
      ),
    ].sort();
    if (allowedProjectKeys.length === 0) {
      return {
        status: RFR_STATUS,
        overdueDays: OVERDUE_DAYS,
        count: 0,
        overdueCount: 0,
        peopleCount: 0,
        projectCount: 0,
        generatedAt: new Date().toISOString(),
        people: [],
        projects: [],
        rows: [],
      };
    }
    const fields = [
      "summary",
      "status",
      "assignee",
      "project",
      "statuscategorychangedate",
      "created",
      "updated",
    ];

    const projectClause = allowedProjectKeys.map((key) => `"${key}"`).join(", ");
    const baseJql = `project in (${projectClause}) AND status = "${RFR_STATUS}"`;
    const jql = `${baseJql} ORDER BY assignee ASC, key ASC`;
    let issues;
    try {
      issues = await this._searchAllJql(jql, fields);
    } catch (err) {
      issues = await this._searchAllJql(baseJql, fields);
    }

    const now = Date.now();
    const rows = await this._mapWithConcurrency(
      issues,
      6,
      (issue) => this._mapRfrIssue(issue, now),
    );

    // Kişi -> RFR'de en uzun bekleyen üstte olacak şekilde sırala.
    rows.sort((a, b) => {
      const an = a.assignee || "\uffff";
      const bn = b.assignee || "\uffff";
      const c = an.localeCompare(bn, "tr");
      if (c !== 0) return c;
      return (b.daysInRfr || 0) - (a.daysInRfr || 0);
    });

    const people = this._summarizePeople(rows);
    const projects = this._summarizeProjects(allowedProjectKeys, rows);
    return {
      status: RFR_STATUS,
      overdueDays: OVERDUE_DAYS,
      count: rows.length,
      overdueCount: rows.filter((r) => r.overdue).length,
      peopleCount: people.length,
      projectCount: projects.length,
      generatedAt: new Date().toISOString(),
      people,
      projects,
      rows,
    };
  }

  async _mapRfrIssue(issue, now) {
    const fields = issue.fields || {};
    const statusName = fields.status ? fields.status.name : RFR_STATUS;
    let rfrSince = null;
    try {
      const histories = await this._fetchIssueChangelog(issue.key);
      rfrSince = this._computeRfrSince(histories, statusName, {
        statusCategoryChangeDate: fields.statuscategorychangedate,
        created: fields.created,
      });
    } catch (error) {
      rfrSince = fields.statuscategorychangedate || fields.created || null;
    }
    const sinceMs = rfrSince ? new Date(rfrSince).getTime() : null;
    const daysInRfr =
      sinceMs != null ? Math.max(0, Math.floor((now - sinceMs) / DAY_MS)) : null;
    return {
      key: issue.key,
      projectKey: fields.project?.key || issue.key?.split("-")[0] || "",
      projectName:
        fields.project?.name ||
        fields.project?.key ||
        issue.key?.split("-")[0] ||
        "",
      summary: fields.summary || "",
      assignee: fields.assignee ? fields.assignee.displayName : null,
      statusName,
      rfrSince,
      daysInRfr,
      overdue: daysInRfr != null && daysInRfr > OVERDUE_DAYS,
    };
  }

  _summarizePeople(rows) {
    const peopleMap = new Map();
    for (const row of rows) {
      const name = row.assignee || "Atanmamış";
      if (!peopleMap.has(name)) {
        peopleMap.set(name, {
          name,
          count: 0,
          overdueCount: 0,
          maxDays: 0,
        });
      }

      const person = peopleMap.get(name);
      person.count++;
      if (row.overdue) person.overdueCount++;
      if ((row.daysInRfr || 0) > person.maxDays) {
        person.maxDays = row.daysInRfr || 0;
      }
    }
    return [...peopleMap.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, "tr"),
    );
  }

  _summarizeProjects(projectKeys, rows) {
    const projects = new Map(
      projectKeys.map((key) => [key, { key, name: key, count: 0 }]),
    );
    for (const row of rows) {
      const key = row.projectKey;
      if (!projects.has(key)) {
        projects.set(key, {
          key,
          name: row.projectName || key,
          count: 0,
        });
      }
      const project = projects.get(key);
      project.name = row.projectName || project.name;
      project.count++;
    }
    return [...projects.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, "tr"),
    );
  }

  /**
   * Verilen satırlardan şablonlu (renkli başlık, kenarlıklar, task linki, filtre)
   * bir .xlsx üretir ve Buffer döner. 1 ayı geçen (gecikmiş) satırlar kırmızı
   * vurgulanır. Türkçe karakterler tam desteklenir.
   */
  async buildRfrXlsxBuffer(rows = [], meta = {}) {
    const ExcelJS = (await import("exceljs")).default;
    const overdueDays = meta.overdueDays ?? OVERDUE_DAYS;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PolatAi Dashboard";
    workbook.created = new Date();

    const ws = workbook.addWorksheet("RFR Takip", {
      views: [{ state: "frozen", ySplit: 3 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    const columns = [
      { header: "Proje", key: "projectName", width: 22 },
      { header: "Atanan Kişi", key: "assignee", width: 24 },
      { header: "Task Kodu", key: "key", width: 15 },
      { header: "Task Özet", key: "summary", width: 60 },
      { header: "Statü", key: "statusName", width: 20 },
      { header: "Son Statü Güncelleme Tarihi", key: "rfrSince", width: 26 },
      { header: "Kaç Gündür RFR'de", key: "daysInRfr", width: 18 },
    ];
    ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));

    const LAST_COL = "G";
    const COL_COUNT = columns.length;
    const NAVY = "FF1F3A5F";
    const HEADER = "FF2E5AAC";
    const ZEBRA = "FFF3F6FB";
    const BORDER = "FFD5DDE8";
    const OVERDUE_FILL = "FFFCE4E6";
    const OVERDUE_TEXT = "FFC0182B";

    // 1. satır: Başlık
    ws.mergeCells(`A1:${LAST_COL}1`);
    const titleCell = ws.getCell("A1");
    titleCell.value = "RFR Takip — Ready For Release Tasklar";
    titleCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: NAVY },
    };
    ws.getRow(1).height = 30;

    // 2. satır: Özet + tarih
    ws.mergeCells(`A2:${LAST_COL}2`);
    const overdueTotal = rows.filter((r) => r.overdue).length;
    const statsCell = ws.getCell("A2");
    statsCell.value = `Statü: ${meta.status || RFR_STATUS}      |      Toplam: ${rows.length}      |      ${overdueDays} günü geçen: ${overdueTotal}      |      Oluşturulma: ${new Date().toLocaleString("tr-TR")}`;
    statsCell.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
    statsCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    statsCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEAF0FA" },
    };
    ws.getRow(2).height = 18;

    // 3. satır: Kolon başlıkları
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

    // Veri satırları
    let rowIdx = 4;
    rows.forEach((r, i) => {
      const row = ws.getRow(rowIdx);
      const zebra = i % 2 === 1;
      const overdue = !!r.overdue;

      row.getCell(1).value = r.projectName || r.projectKey || "";

      const c2 = row.getCell(2);
      c2.value = r.assignee || "Atanmamış";
      if (!r.assignee) c2.font = { color: { argb: "FFAAAAAA" }, italic: true };

      const c3 = row.getCell(3);
      c3.value = r.key
        ? { text: r.key, hyperlink: `${HEBIAR_BASE_URL}/browse/${r.key}` }
        : "";
      c3.font = { color: { argb: "FF1155CC" }, underline: true, bold: true };

      row.getCell(4).value = r.summary || "";
      row.getCell(5).value = r.statusName || meta.status || RFR_STATUS;

      const c6 = row.getCell(6);
      if (r.rfrSince) {
        c6.value = new Date(r.rfrSince);
        c6.numFmt = "dd.mm.yyyy hh:mm";
      } else {
        c6.value = "—";
        c6.font = { color: { argb: "FFAAAAAA" } };
      }

      const c7 = row.getCell(7);
      c7.value = r.daysInRfr != null ? r.daysInRfr : "—";

      for (let col = 1; col <= COL_COUNT; col++) {
        const cell = row.getCell(col);
        cell.border = {
          top: { style: "hair", color: { argb: BORDER } },
          left: { style: "hair", color: { argb: BORDER } },
          bottom: { style: "hair", color: { argb: BORDER } },
          right: { style: "hair", color: { argb: BORDER } },
        };
        cell.alignment = {
          vertical: "middle",
          horizontal: col === 4 ? "left" : "center",
          wrapText: col === 4,
        };
        if (overdue) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: OVERDUE_FILL },
          };
        } else if (zebra) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: ZEBRA },
          };
        }
      }

      if (overdue) {
        row.getCell(7).font = { bold: true, color: { argb: OVERDUE_TEXT } };
        row.getCell(2).font = {
          bold: true,
          color: { argb: r.assignee ? OVERDUE_TEXT : "FFAAAAAA" },
        };
      }

      row.height = 18;
      rowIdx++;
    });

    // Başlık satırına filtre (kişi/statü Excel'de de filtrelenebilir)
    ws.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: 3, column: COL_COUNT },
    };

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

export default new RfrReportService();
