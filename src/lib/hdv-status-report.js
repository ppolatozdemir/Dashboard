import axios from "axios";
import { getConfig } from "./config.js";

/**
 * "HDV Son Durum" raporu:
 * Hebiar (Commercelab) Jira'sındaki HDV projesindeki taskları, YALNIZCA belirli
 * kişilere atanmış olanları listeler. Her satır için Task No, Task Özeti,
 * Atanan Kişi, Sprint, Task Durumu (statü) ve Reporter bilgisi döner.
 *
 * Not: Hebiar sabit URL'dir; config.baseUrl Olka'yı gösterse bile bu rapor daima
 * Hebiar'a bağlanır (HEBIAR_BASE_URL ile override edilebilir).
 */

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const PROJECT = process.env.HDV_PROJECT || "HDV";
const REQ_TIMEOUT = Number(process.env.HDV_TIMEOUT_MS || 30000);

// Yalnızca bu kişilere atanmış tasklar listelenir (kullanıcı onayı ile sabit liste).
const ALLOWED_ASSIGNEES = [
  "Gökhan Koçak",
  "Mehmet Ali Alagöz",
  "Serkan Doksöz",
  "Burak Selçuk",
  "Amir Daliri",
  "Alper Özçelik",
];

/** İsimleri diyakritiksiz/normalize ederek karşılaştırmak için. */
function normName(s) {
  return (s || "")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/\s+/g, " ")
    .trim();
}

const HDV_COLUMNS = [
  { header: "Task No", key: "key", width: 15 },
  { header: "Task Özeti", key: "summary", width: 60 },
  { header: "Atanan Kişi", key: "assignee", width: 24 },
  { header: "Sprint", key: "sprint", width: 20 },
  { header: "Task Durumu", key: "statusName", width: 18 },
  { header: "Reporter", key: "reporter", width: 24 },
];
const HDV_COLORS = {
  navy: "FF1E3A8A",
  header: "FF2E5AAC",
  zebra: "FFEAF0FA",
  border: "FFD5DEEF",
};

function styleHdvReportHeader(worksheet, rows) {
  worksheet.mergeCells("A1:F1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = "HDV Son Durum — Açık (Tamamlanmamış) Tasklar";
  titleCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HDV_COLORS.navy } };
  worksheet.getRow(1).height = 30;

  worksheet.mergeCells("A2:F2");
  const statsCell = worksheet.getCell("A2");
  statsCell.value = `Proje: HDV      |      Toplam: ${rows.length}      |      Oluşturulma: ${new Date().toLocaleString("tr-TR")}`;
  statsCell.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
  statsCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  statsCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EFFA" } };
  worksheet.getRow(2).height = 18;
}

function styleHdvColumnHeader(worksheet) {
  const headerRow = worksheet.getRow(3);
  HDV_COLUMNS.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HDV_COLORS.header } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: HDV_COLORS.border } },
      left: { style: "thin", color: { argb: HDV_COLORS.border } },
      bottom: { style: "medium", color: { argb: HDV_COLORS.navy } },
      right: { style: "thin", color: { argb: HDV_COLORS.border } },
    };
  });
  headerRow.height = 24;
}

function styleHdvDataCell(cell, column, zebra) {
  cell.border = {
    top: { style: "hair", color: { argb: HDV_COLORS.border } },
    left: { style: "hair", color: { argb: HDV_COLORS.border } },
    bottom: { style: "hair", color: { argb: HDV_COLORS.border } },
    right: { style: "hair", color: { argb: HDV_COLORS.border } },
  };
  cell.alignment = {
    vertical: "middle",
    horizontal: column === 2 ? "left" : "center",
    wrapText: column === 2,
  };
  if (zebra) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HDV_COLORS.zebra } };
  }
}

function addHdvDataRow(worksheet, item, index) {
  const row = worksheet.getRow(index + 4);
  const taskCell = row.getCell(1);
  taskCell.value = item.key
    ? { text: item.key, hyperlink: `${HEBIAR_BASE_URL}/browse/${item.key}` }
    : "";
  taskCell.font = { color: { argb: "FF1155CC" }, underline: true, bold: true };
  row.getCell(2).value = item.summary || "";
  row.getCell(3).value = item.assignee || "Atanmamış";
  row.getCell(4).value = item.sprint || "—";
  row.getCell(5).value = item.statusName || "—";
  row.getCell(6).value = item.reporter || "—";
  if (!item.assignee) row.getCell(3).font = { color: { argb: "FFAAAAAA" }, italic: true };
  if (!item.sprint) row.getCell(4).font = { color: { argb: "FFAAAAAA" } };
  if (!item.reporter) row.getCell(6).font = { color: { argb: "FFAAAAAA" } };
  for (let column = 1; column <= HDV_COLUMNS.length; column++) {
    styleHdvDataCell(row.getCell(column), column, index % 2 === 1);
  }
  row.height = 18;
}

export class HdvStatusReportService {
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
   * Enhanced JQL search endpoint'i ile bir sorgunun tüm sonuçlarını
   * (nextPageToken ile sayfalı) çeker.
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
        timeout: REQ_TIMEOUT,
      });

      all.push(...(res.data.issues || []));
      nextPageToken = res.data.isLast ? null : res.data.nextPageToken || null;
      pages++;
    } while (nextPageToken && pages < 60);

    return all;
  }

  /** Verilen sorgu ile Hebiar kullanıcılarını arar. */
  async _searchUsers(query) {
    try {
      const res = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/user/search`, {
        params: { query, maxResults: 50 },
        headers: this.getAuthHeader(),
        timeout: REQ_TIMEOUT,
      });
      return res.data || [];
    } catch (err) {
      return [];
    }
  }

  /**
   * İzin verilen isimleri Hebiar accountId'lerine çözer. Her isim için tam ad ve
   * ilk isimle arama yapıp, normalize edilmiş displayName eşleşmesini seçer.
   * name -> accountId Map'i döner.
   */
  async _resolveAccountIds() {
    const map = new Map();

    for (const name of ALLOWED_ASSIGNEES) {
      const wanted = normName(name);
      const queries = new Set([name, name.split(/\s+/)[0]]);
      const candidates = [];
      const seen = new Set();

      for (const q of queries) {
        if (!q) continue;
        const users = await this._searchUsers(q);
        for (const u of users) {
          if (u.accountId && !seen.has(u.accountId)) {
            seen.add(u.accountId);
            candidates.push(u);
          }
        }
      }

      // 1) Atlassian hesabı + tam normalize eşleşme
      let hit = candidates.find(
        (u) =>
          u.accountType === "atlassian" && normName(u.displayName) === wanted,
      );
      // 2) Hesap tipinden bağımsız tam normalize eşleşme
      if (!hit)
        hit = candidates.find((u) => normName(u.displayName) === wanted);

      if (hit) map.set(name, hit.accountId);
    }

    return map;
  }

  /**
   * Jira Sprint alanından (customfield_10020, dizi olabilir) okunabilir sprint
   * adını çıkarır. Alan; obje dizisi ({name,state,...}) ya da eski string biçiminde
   * (…[name=…,state=…]) olabilir. Öncelik: aktif > future > en son (closed) sprint.
   */
  extractSprint(sprintField) {
    if (!sprintField) return null;
    const arr = Array.isArray(sprintField) ? sprintField : [sprintField];
    const parsed = arr
      .map((s) => {
        if (!s) return null;
        if (typeof s === "object") {
          return {
            name: s.name || null,
            state: (s.state || "").toLowerCase(),
          };
        }
        const nameM = String(s).match(/name=([^,\]]+)/);
        const stateM = String(s).match(/state=([^,\]]+)/);
        return {
          name: nameM ? nameM[1] : null,
          state: stateM ? stateM[1].toLowerCase() : "",
        };
      })
      .filter((x) => x && x.name);
    if (parsed.length === 0) return null;
    const active = parsed.find((p) => p.state === "active");
    if (active) return active.name;
    const future = parsed.find((p) => p.state === "future");
    if (future) return future.name;
    return parsed[parsed.length - 1].name;
  }

  /**
   * HDV projesinde yalnızca izin verilen kişilere atanmış taskları döner.
   * Kişiler accountId'ye çözülebiliyorsa JQL sunucu tarafında filtreler; aksi
   * halde atanmış tüm HDV taskları çekilip isimle güvenli şekilde süzülür.
   */
  async getHdvStatusTasks() {
    const SPRINT_FIELD = "customfield_10020";
    const fields = ["summary", "status", "assignee", SPRINT_FIELD, "reporter"];
    const allowedSet = new Set(ALLOWED_ASSIGNEES.map(normName));
    const issues = await this._fetchAllowedIssues(fields);
    const rows = issues
      .map((issue) => this._mapStatusIssue(issue, SPRINT_FIELD))
      .filter(
        (row) =>
          row.sprint &&
          row.assignee &&
          allowedSet.has(normName(row.assignee)),
      );
    rows.sort((a, b) => {
      const comparison = (a.assignee || "").localeCompare(
        b.assignee || "",
        "tr",
      );
      if (comparison !== 0) return comparison;
      return (b.key || "").localeCompare(a.key || "", "tr", { numeric: true });
    });
    return {
      generatedAt: new Date().toISOString(),
      project: PROJECT,
      allowedAssignees: ALLOWED_ASSIGNEES,
      people: this._summarizeAssignees(rows),
      rows,
      count: rows.length,
    };
  }

  async _fetchAllowedIssues(fields) {
    let accountMap = new Map();
    try {
      accountMap = await this._resolveAccountIds();
    } catch (err) {
      accountMap = new Map();
    }

    let issues = [];
    // Tüm kişiler çözülebildiyse verimli JQL kullan; biri eksikse hiç kimse
    // atlanmasın diye atanmış tüm taskları çekip isimle süzeceğiz.
    if (accountMap.size === ALLOWED_ASSIGNEES.length) {
      const idClause = [...accountMap.values()]
        .map((id) => `"${id}"`)
        .join(", ");
      const jql = `project = ${PROJECT} AND Sprint is not EMPTY AND assignee in (${idClause}) AND statusCategory != Done ORDER BY assignee ASC, key DESC`;
      try {
        issues = await this._searchAllJql(jql, fields);
      } catch (err) {
        issues = [];
      }
    }

    if (issues.length === 0) {
      const jql = `project = ${PROJECT} AND Sprint is not EMPTY AND assignee is not EMPTY AND statusCategory != Done ORDER BY assignee ASC, key DESC`;
      issues = await this._searchAllJql(jql, fields);
    }
    return issues;
  }

  _mapStatusIssue(issue, sprintField) {
    const fields = issue.fields || {};
    return {
      key: issue.key,
      summary: fields.summary || "",
      assignee: fields.assignee ? fields.assignee.displayName : null,
      sprint: this.extractSprint(fields[sprintField]),
      statusName: fields.status ? fields.status.name : null,
      statusCategory: fields.status?.statusCategory?.key || null,
      reporter: fields.reporter ? fields.reporter.displayName : null,
    };
  }

  _summarizeAssignees(rows) {
    const countByName = new Map(ALLOWED_ASSIGNEES.map((n) => [normName(n), 0]));
    for (const row of rows) {
      const key = normName(row.assignee);
      if (countByName.has(key)) {
        countByName.set(key, countByName.get(key) + 1);
      }
    }
    return ALLOWED_ASSIGNEES.map((name) => ({
      name,
      count: countByName.get(normName(name)) || 0,
    }));
  }

  /**
   * Verilen satırlardan şablonlu (renkli başlık, kenarlıklar, task linki, filtre)
   * bir .xlsx üretir ve Buffer döner. Türkçe karakterler tam desteklenir.
   * Kolonlar: Task No | Task Özeti | Atanan Kişi | Sprint | Task Durumu | Reporter
   */
  async buildHdvStatusXlsxBuffer(rows = [], meta = {}) {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PolatAi Dashboard";
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet("HDV Son Durum", {
      views: [{ state: "frozen", ySplit: 3 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });
    worksheet.columns = HDV_COLUMNS.map((column) => ({
      key: column.key,
      width: column.width,
    }));
    styleHdvReportHeader(worksheet, rows);
    styleHdvColumnHeader(worksheet);
    rows.forEach((item, index) => addHdvDataRow(worksheet, item, index));
    worksheet.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: 3, column: HDV_COLUMNS.length },
    };
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

const hdvStatusReportService = new HdvStatusReportService();
export default hdvStatusReportService;
