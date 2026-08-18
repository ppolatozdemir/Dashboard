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

class HdvStatusReportService {
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
      const jql = `project = ${PROJECT} AND assignee in (${idClause}) AND statusCategory != Done ORDER BY assignee ASC, key DESC`;
      try {
        issues = await this._searchAllJql(jql, fields);
      } catch (err) {
        issues = [];
      }
    }

    if (issues.length === 0) {
      const jql = `project = ${PROJECT} AND assignee is not EMPTY AND statusCategory != Done ORDER BY assignee ASC, key DESC`;
      issues = await this._searchAllJql(jql, fields);
    }

    const rows = issues
      .map((issue) => {
        const f = issue.fields || {};
        return {
          key: issue.key,
          summary: f.summary || "",
          assignee: f.assignee ? f.assignee.displayName : null,
          sprint: this.extractSprint(f[SPRINT_FIELD]),
          statusName: f.status ? f.status.name : null,
          statusCategory: f.status?.statusCategory?.key || null,
          reporter: f.reporter ? f.reporter.displayName : null,
        };
      })
      // Güvenlik süzgeci: yalnızca izin verilen kişiler.
      .filter((r) => r.assignee && allowedSet.has(normName(r.assignee)));

    // Atanan kişi (Türkçe) -> key azalan (yeni task üstte) sıralaması.
    rows.sort((a, b) => {
      const c = (a.assignee || "").localeCompare(b.assignee || "", "tr");
      if (c !== 0) return c;
      return (b.key || "").localeCompare(a.key || "", "tr", { numeric: true });
    });

    // Kişi bazlı özet (izin verilen sırayla, 0 olanlar da görünür).
    const countByName = new Map(ALLOWED_ASSIGNEES.map((n) => [normName(n), 0]));
    for (const r of rows) {
      const k = normName(r.assignee);
      if (countByName.has(k)) countByName.set(k, countByName.get(k) + 1);
    }
    const people = ALLOWED_ASSIGNEES.map((name) => ({
      name,
      count: countByName.get(normName(name)) || 0,
    }));

    return {
      generatedAt: new Date().toISOString(),
      project: PROJECT,
      allowedAssignees: ALLOWED_ASSIGNEES,
      people,
      rows,
      count: rows.length,
    };
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

    const ws = workbook.addWorksheet("HDV Son Durum", {
      views: [{ state: "frozen", ySplit: 3 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    const columns = [
      { header: "Task No", key: "key", width: 15 },
      { header: "Task Özeti", key: "summary", width: 60 },
      { header: "Atanan Kişi", key: "assignee", width: 24 },
      { header: "Sprint", key: "sprint", width: 20 },
      { header: "Task Durumu", key: "statusName", width: 18 },
      { header: "Reporter", key: "reporter", width: 24 },
    ];
    ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));

    const LAST_COL = "F";
    const COL_COUNT = columns.length;
    const NAVY = "FF1E3A8A";
    const HEADER = "FF2E5AAC";
    const ZEBRA = "FFEAF0FA";
    const BORDER = "FFD5DEEF";

    // 1. satır: Başlık
    ws.mergeCells(`A1:${LAST_COL}1`);
    const titleCell = ws.getCell("A1");
    titleCell.value = "HDV Son Durum — Açık (Tamamlanmamış) Tasklar";
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
    const statsCell = ws.getCell("A2");
    statsCell.value = `Proje: HDV      |      Toplam: ${rows.length}      |      Oluşturulma: ${new Date().toLocaleString("tr-TR")}`;
    statsCell.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
    statsCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    statsCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE9EFFA" },
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

      const c1 = row.getCell(1);
      c1.value = r.key
        ? { text: r.key, hyperlink: `${HEBIAR_BASE_URL}/browse/${r.key}` }
        : "";
      c1.font = { color: { argb: "FF1155CC" }, underline: true, bold: true };

      row.getCell(2).value = r.summary || "";

      const c3 = row.getCell(3);
      c3.value = r.assignee || "Atanmamış";
      if (!r.assignee) c3.font = { color: { argb: "FFAAAAAA" }, italic: true };

      const c4 = row.getCell(4);
      c4.value = r.sprint || "—";
      if (!r.sprint) c4.font = { color: { argb: "FFAAAAAA" } };

      row.getCell(5).value = r.statusName || "—";

      const c6 = row.getCell(6);
      c6.value = r.reporter || "—";
      if (!r.reporter) c6.font = { color: { argb: "FFAAAAAA" } };

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
          horizontal: col === 2 ? "left" : "center",
          wrapText: col === 2,
        };
        if (zebra) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: ZEBRA },
          };
        }
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

const hdvStatusReportService = new HdvStatusReportService();
export default hdvStatusReportService;
