import axios from "axios";
import { getConfig } from "./config.js";

/**
 * "Sprinte Al?nmayan" raporu:
 * Olka (E-COMM DEVELOPMENT TEAM) sprintinde olup, se?ilen Hebiar (weekly) sprintine
 * al?nmam?? tasklar? listeler. E?le?tirme Olka task?ndaki CLLINK alan?na g?re yap?l?r.
 *
 * Her iki Jira'ya da ayn? email + API token ile ba?lan?l?r (Atlassian token hesap kapsaml?d?r).
 */

const OLKA_BASE_URL = (
  process.env.OLKA_BASE_URL || "https://olkaproduct.atlassian.net"
).replace(/\/$/, "");
const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const OLKA_PROJECT_QUERY =
  process.env.OLKA_PROJECT_QUERY || "E-COMM DEVELOPMENT TEAM";
const CLLINK_FIELD_NAME = "CLLINK";
const HEBIAR_WEEKLY_BOARD_ID = parseInt(
  process.env.HEBIAR_WEEKLY_BOARD_ID || "54",
  10,
);

class UnsprintedReportService {
  constructor() {
    this._cllinkFieldId = null;
    this._olkaBoardId = null;
  }

  getAuthHeader() {
    const { email, apiToken } = getConfig();
    if (!email || !apiToken) {
      throw new Error(
        'Jira kimlik bilgileri eksik. ?nce "jira config setup" komutunu ?al??t?r?n.',
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
   * Olka'daki CLLINK custom field id'sini bulur (customfield_XXXXX).
   */
  async getCllinkFieldId() {
    if (this._cllinkFieldId) return this._cllinkFieldId;

    const res = await axios.get(`${OLKA_BASE_URL}/rest/api/3/field`, {
      headers: this.getAuthHeader(),
    });
    const fields = res.data || [];
    const field =
      fields.find(
        (f) =>
          (f.name || "").trim().toLowerCase() ===
          CLLINK_FIELD_NAME.toLowerCase(),
      ) || fields.find((f) => (f.name || "").toLowerCase().includes("cllink"));

    this._cllinkFieldId = field ? field.id : null;
    return this._cllinkFieldId;
  }

  /**
   * Olka "E-COMM DEVELOPMENT TEAM" projesinin scrum board id'sini bulur.
   */
  async getOlkaBoardId() {
    if (this._olkaBoardId) return this._olkaBoardId;

    const headers = this.getAuthHeader();

    // 1. Projeyi bul
    const projRes = await axios.get(
      `${OLKA_BASE_URL}/rest/api/3/project/search`,
      {
        params: { query: OLKA_PROJECT_QUERY, maxResults: 50 },
        headers,
      },
    );
    const projects = projRes.data.values || [];
    const project =
      projects.find((p) =>
        (p.name || "").toUpperCase().includes("E-COMM DEVELOPMENT"),
      ) || projects[0];

    if (!project) {
      throw new Error(`Olka'da "${OLKA_PROJECT_QUERY}" projesi bulunamad?.`);
    }

    // 2. Projenin board'unu bul (scrum tercih edilir)
    const boardRes = await axios.get(`${OLKA_BASE_URL}/rest/agile/1.0/board`, {
      params: { projectKeyOrId: project.key, maxResults: 50 },
      headers,
    });
    const boards = boardRes.data.values || [];
    const board = boards.find((b) => b.type === "scrum") || boards[0];

    if (!board) {
      throw new Error(`Olka "${project.name}" projesi i?in board bulunamad?.`);
    }

    this._olkaBoardId = board.id;
    return this._olkaBoardId;
  }

  /**
   * Bir board'un t?m sprintlerini (sayfal?) ?eker.
   */
  async _fetchAllSprints(baseUrl, boardId, state) {
    const headers = this.getAuthHeader();
    let startAt = 0;
    let isLast = false;
    const all = [];

    while (!isLast) {
      const res = await axios.get(
        `${baseUrl}/rest/agile/1.0/board/${boardId}/sprint`,
        {
          params: { state, startAt, maxResults: 50 },
          headers,
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
   * Sprintleri s?ralar: aktif > future > closed. Closed olanlar en yeni 40 taneyle s?n?rlan?r.
   */
  _sortSprints(sprints) {
    const byStartDesc = (a, b) => {
      const da = a.startDate ? new Date(a.startDate).getTime() : 0;
      const db = b.startDate ? new Date(b.startDate).getTime() : 0;
      return db - da;
    };

    const active = sprints
      .filter((s) => s.state === "active")
      .sort(byStartDesc);
    const future = sprints
      .filter((s) => s.state === "future")
      .sort(byStartDesc);
    const closed = sprints
      .filter((s) => s.state === "closed")
      .sort(byStartDesc)
      .slice(0, 40);

    return [...active, ...future, ...closed].map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
      startDate: s.startDate || null,
      endDate: s.endDate || null,
    }));
  }

  async getOlkaSprints() {
    const boardId = await this.getOlkaBoardId();
    const sprints = await this._fetchAllSprints(
      OLKA_BASE_URL,
      boardId,
      "active,future,closed",
    );
    return this._sortSprints(sprints);
  }

  async getHebiarSprints() {
    const sprints = await this._fetchAllSprints(
      this.getHebiarBaseUrl(),
      HEBIAR_WEEKLY_BOARD_ID,
      "active,future,closed",
    );
    return this._sortSprints(sprints);
  }

  /**
   * Bir sprintteki t?m issue'lar? (sayfal?) ?eker.
   */
  async _fetchAllSprintIssues(baseUrl, sprintId, fields) {
    const headers = this.getAuthHeader();
    let startAt = 0;
    let total = Infinity;
    const all = [];

    while (startAt < total) {
      const res = await axios.get(
        `${baseUrl}/rest/agile/1.0/sprint/${sprintId}/issue`,
        {
          params: { startAt, maxResults: 100, fields: fields.join(",") },
          headers,
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
   * CLLINK alan de?erinden Hebiar (CL) task anahtar?n? ??kar?r.
   * De?er d?z metin URL, d?z key veya ADF/nesne olabilir.
   */
  extractClKey(value) {
    if (!value) return null;
    const str = typeof value === "string" ? value : JSON.stringify(value);
    const match = str.match(/([A-Z][A-Z0-9]+-\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Olka sprintinde olup Hebiar sprintine al?nmam?? tasklar? d?ner.
   */
  async getUnsprintedTasks(olkaSprintId, hebiarSprintId) {
    const cllinkFieldId = await this.getCllinkFieldId();

    const olkaFields = [
      "summary",
      "status",
      "assignee",
      "reporter",
      "priority",
    ];
    if (cllinkFieldId) olkaFields.push(cllinkFieldId);

    const hebiarBase = this.getHebiarBaseUrl();

    const [olkaIssues, hebiarIssues] = await Promise.all([
      this._fetchAllSprintIssues(OLKA_BASE_URL, olkaSprintId, olkaFields),
      this._fetchAllSprintIssues(hebiarBase, hebiarSprintId, ["summary"]),
    ]);

    const hebiarKeys = new Set(hebiarIssues.map((i) => i.key));

    const rows = [];
    for (const issue of olkaIssues) {
      const f = issue.fields || {};
      const clValue = cllinkFieldId ? f[cllinkFieldId] : null;
      const clKey = this.extractClKey(clValue);

      // CL kar??l??? se?ilen Hebiar sprintinde ise "al?nm??" say?l?r, atlan?r.
      const inHebiarSprint = clKey ? hebiarKeys.has(clKey) : false;
      if (inHebiarSprint) continue;

      rows.push({
        olkaKey: issue.key,
        clKey: clKey || null,
        summary: f.summary || "",
        assignee: f.assignee ? f.assignee.displayName : null,
        reporter: f.reporter ? f.reporter.displayName : null,
        status: f.status ? f.status.name : null,
        statusCategory:
          f.status && f.status.statusCategory
            ? f.status.statusCategory.key
            : null,
        priority: f.priority ? f.priority.name : null,
      });
    }

    // ?ncelik ve key'e g?re okunabilir bir s?ralama
    rows.sort((a, b) =>
      a.olkaKey.localeCompare(b.olkaKey, undefined, { numeric: true }),
    );

    return {
      olkaSprintId,
      hebiarSprintId,
      cllinkFieldFound: !!cllinkFieldId,
      olkaTotal: olkaIssues.length,
      hebiarTotal: hebiarIssues.length,
      count: rows.length,
      rows,
    };
  }

  /**
   * Verilen sat?rlardan ?ablonlu (renkli ba?l?k, kenarl?klar, linkler, filtre) bir
   * .xlsx dosyas? ?retir ve Buffer d?ner. T?rk?e karakterler tam desteklenir.
   */
  async buildUnsprintedXlsxBuffer(rows = [], meta = {}) {
    const ExcelJS = (await import("exceljs")).default;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PolatAi Dashboard";
    workbook.created = new Date();

    const ws = workbook.addWorksheet("Sprinte Al?nmayan", {
      views: [{ state: "frozen", ySplit: 4 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    const columns = [
      { header: "Olka Task No", key: "olkaKey", width: 15 },
      { header: "CL Task No", key: "clKey", width: 15 },
      { header: "Task Ad?", key: "summary", width: 60 },
      { header: "Atanan Ki?i", key: "assignee", width: 24 },
      { header: "Reporter", key: "reporter", width: 24 },
      { header: "Stat?s?", key: "status", width: 18 },
      { header: "?ncelik Seviyesi", key: "priority", width: 18 },
    ];
    ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));

    const LAST_COL = "G";
    const NAVY = "FF1F3A5F";
    const HEADER = "FF2E5AAC";
    const ZEBRA = "FFF3F6FB";
    const BORDER = "FFD5DDE8";

    // 1. sat?r: Ba?l?k
    ws.mergeCells(`A1:${LAST_COL}1`);
    const titleCell = ws.getCell("A1");
    titleCell.value = "Sprinte Al?nmayan Tasklar";
    titleCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: NAVY },
    };
    ws.getRow(1).height = 30;

    // 2. sat?r: Sprint bilgisi
    ws.mergeCells(`A2:${LAST_COL}2`);
    const infoCell = ws.getCell("A2");
    infoCell.value = `Olka Sprint: ${meta.olkaSprintName || "-"}      ?      Hebiar Weekly Sprint: ${meta.hebiarSprintName || "-"}`;
    infoCell.font = { bold: true, size: 11, color: { argb: "FF25324B" } };
    infoCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    infoCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEAF0FA" },
    };
    ws.getRow(2).height = 20;

    // 3. sat?r: ?zet + tarih
    ws.mergeCells(`A3:${LAST_COL}3`);
    const statsCell = ws.getCell("A3");
    statsCell.value = `Sprinte al?nmayan: ${rows.length}      |      Olka toplam: ${meta.olkaTotal ?? "-"}      |      Hebiar sprint toplam: ${meta.hebiarTotal ?? "-"}      |      Olu?turulma: ${new Date().toLocaleString("tr-TR")}`;
    statsCell.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
    statsCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(3).height = 18;

    // 4. sat?r: Kolon ba?l?klar?
    const headerRow = ws.getRow(4);
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
    headerRow.height = 22;

    const prioColor = (p) => {
      const s = (p || "").toLowerCase();
      if (s.includes("highest") || s.includes("en y?ksek")) return "FFC0392B";
      if (s.includes("high") || s.includes("y?ksek")) return "FFD35400";
      if (s.includes("medium") || s.includes("orta")) return "FFB7950B";
      if (s.includes("low") || s.includes("d???k")) return "FF1E8449";
      return "FF555555";
    };

    // Veri sat?rlar?
    let rowIdx = 5;
    rows.forEach((r, i) => {
      const row = ws.getRow(rowIdx);
      const zebra = i % 2 === 1;

      const c1 = row.getCell(1);
      c1.value = r.olkaKey
        ? { text: r.olkaKey, hyperlink: `${OLKA_BASE_URL}/browse/${r.olkaKey}` }
        : "";
      c1.font = { color: { argb: "FF1155CC" }, underline: true, bold: true };

      const c2 = row.getCell(2);
      if (r.clKey) {
        c2.value = {
          text: r.clKey,
          hyperlink: `${HEBIAR_BASE_URL}/browse/${r.clKey}`,
        };
        c2.font = { color: { argb: "FF1E8449" }, underline: true };
      } else {
        c2.value = "?";
        c2.font = { color: { argb: "FFAAAAAA" } };
      }

      row.getCell(3).value = r.summary || "";
      const c4 = row.getCell(4);
      c4.value = r.assignee || "Atanmam??";
      if (!r.assignee) c4.font = { color: { argb: "FFAAAAAA" }, italic: true };
      row.getCell(5).value = r.reporter || "?";
      row.getCell(6).value = r.status || "?";
      const c7 = row.getCell(7);
      c7.value = r.priority || "?";
      c7.font = { color: { argb: prioColor(r.priority) }, bold: true };

      for (let col = 1; col <= 7; col++) {
        const cell = row.getCell(col);
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

    // Ba?l?k sat?r?na filtre
    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4, column: 7 },
    };

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

export default new UnsprintedReportService();
