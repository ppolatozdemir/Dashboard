import axios from "axios";
import { getConfig } from "./config.js";

/**
 * "Olka Deploy" raporu:
 * Olka (E-COMM DEVELOPMENT TEAM) Jira'sında statüsü "Ready for Ship" olan taskları listeler.
 * Her task için CLLINK alanından Hebiar (CL) task anahtarı çıkarılır ve o taskın
 * CL üzerindeki atanan kişisi ile statüsü de çekilir.
 *
 * Her iki Jira'ya da aynı email + API token ile bağlanılır (Atlassian token hesap kapsamlıdır).
 */

const OLKA_BASE_URL = (
  process.env.OLKA_BASE_URL || "https://olkaproduct.atlassian.net"
).replace(/\/$/, "");
const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const OLKA_PROJECT_QUERY =
  process.env.OLKA_PROJECT_QUERY || "E-COMM DEVELOPMENT TEAM";
const DEPLOY_STATUS = process.env.OLKA_DEPLOY_STATUS || "Ready for Ship";
const CLLINK_FIELD_NAME = "CLLINK";

class OlkaDeployReportService {
  constructor() {
    this._cllinkFieldId = null;
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
   * CLLINK alan değerinden Hebiar (CL) task anahtarını çıkarır.
   * Değer düz metin URL, düz key veya ADF/nesne olabilir.
   */
  extractClKey(value) {
    if (!value) return null;
    const str = typeof value === "string" ? value : JSON.stringify(value);
    const match = str.match(/([A-Z][A-Z0-9]+-\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Yeni "Enhanced JQL" search endpoint'i ile bir sorgunun tüm sonuçlarını
   * (nextPageToken ile sayfalı) çeker.
   */
  async _searchAllJql(baseUrl, jql, fields) {
    const headers = this.getAuthHeader();
    let nextPageToken = null;
    const all = [];

    do {
      const params = {
        jql,
        fields: fields.join(","),
        maxResults: 100,
      };
      if (nextPageToken) params.nextPageToken = nextPageToken;

      const res = await axios.get(`${baseUrl}/rest/api/3/search/jql`, {
        params,
        headers,
      });

      const issues = res.data.issues || [];
      all.push(...issues);

      nextPageToken = res.data.isLast ? null : res.data.nextPageToken || null;
    } while (nextPageToken);

    return all;
  }

  /**
   * Hebiar'daki bir grup task için statü + atanan kişi bilgisini çeker.
   * Anahtarlar 50'lik gruplara bölünerek sorgulanır.
   */
  async _fetchClDetails(clKeys) {
    const details = new Map();
    const unique = [...new Set(clKeys.filter(Boolean))];
    if (unique.length === 0) return details;

    const chunkSize = 50;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const jql = `key in (${chunk.map((k) => `"${k}"`).join(",")})`;
      try {
        const issues = await this._searchAllJql(HEBIAR_BASE_URL, jql, [
          "status",
          "assignee",
        ]);
        for (const issue of issues) {
          const f = issue.fields || {};
          details.set(issue.key, {
            clStatus: f.status ? f.status.name : null,
            clStatusCategory:
              f.status && f.status.statusCategory
                ? f.status.statusCategory.key
                : null,
            clAssignee: f.assignee ? f.assignee.displayName : null,
          });
        }
      } catch (err) {
        // Bir grup bulunamazsa (silinmiş/erişilemeyen key'ler) diğerlerini bozmadan devam et.
        console.error(
          "Hebiar CL detay sorgusu hatası:",
          err.response?.data?.errorMessages || err.message,
        );
      }
    }

    return details;
  }

  /**
   * Statüsü "Ready for Ship" olan Olka tasklarını, CL karşılıklarıyla birlikte döner.
   */
  async getDeployTasks() {
    const cllinkFieldId = await this.getCllinkFieldId();

    const olkaFields = ["summary", "status", "assignee", "reporter"];
    if (cllinkFieldId) olkaFields.push(cllinkFieldId);

    const jql = `project = "${OLKA_PROJECT_QUERY}" AND status = "${DEPLOY_STATUS}" ORDER BY key ASC`;

    let olkaIssues;
    try {
      olkaIssues = await this._searchAllJql(OLKA_BASE_URL, jql, olkaFields);
    } catch (err) {
      // Proje adı JQL'de sorun çıkarırsa yalnızca statü ile tekrar dene.
      const fallbackJql = `status = "${DEPLOY_STATUS}" ORDER BY key ASC`;
      olkaIssues = await this._searchAllJql(
        OLKA_BASE_URL,
        fallbackJql,
        olkaFields,
      );
    }

    // Önce CL anahtarlarını topla, sonra tek seferde Hebiar detaylarını çek.
    const preRows = olkaIssues.map((issue) => {
      const f = issue.fields || {};
      const clValue = cllinkFieldId ? f[cllinkFieldId] : null;
      return {
        olkaKey: issue.key,
        summary: f.summary || "",
        assignee: f.assignee ? f.assignee.displayName : null,
        reporter: f.reporter ? f.reporter.displayName : null,
        clKey: this.extractClKey(clValue),
      };
    });

    const clDetails = await this._fetchClDetails(preRows.map((r) => r.clKey));

    const rows = preRows.map((r) => {
      const detail = r.clKey ? clDetails.get(r.clKey) : null;
      return {
        ...r,
        clAssignee: detail ? detail.clAssignee : null,
        clStatus: detail ? detail.clStatus : null,
        clStatusCategory: detail ? detail.clStatusCategory : null,
      };
    });

    rows.sort((a, b) =>
      a.olkaKey.localeCompare(b.olkaKey, undefined, { numeric: true }),
    );

    // Filtre için benzersiz CL statü listesi
    const clStatuses = [
      ...new Set(rows.map((r) => r.clStatus).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, "tr"));

    return {
      status: DEPLOY_STATUS,
      cllinkFieldFound: !!cllinkFieldId,
      count: rows.length,
      clStatuses,
      rows,
    };
  }

  /**
   * Verilen satırlardan şablonlu (renkli başlık, kenarlıklar, linkler, filtre) bir
   * .xlsx dosyası üretir ve Buffer döner. Türkçe karakterler tam desteklenir.
   * Son iki kolon (Deploy Çıkacak Kişi, Not) manuel doldurulmak üzere boş bırakılır.
   */
  async buildOlkaDeployXlsxBuffer(rows = [], meta = {}) {
    const ExcelJS = (await import("exceljs")).default;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PolatAi Dashboard";
    workbook.created = new Date();

    const ws = workbook.addWorksheet("Olka Deploy", {
      views: [{ state: "frozen", ySplit: 3 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    const columns = [
      { header: "Olka Task No", key: "olkaKey", width: 15 },
      { header: "Task Adı", key: "summary", width: 55 },
      { header: "Atanan Kişi", key: "assignee", width: 22 },
      { header: "Reporter", key: "reporter", width: 22 },
      { header: "Cl Task No", key: "clKey", width: 15 },
      { header: "Cl Atanan Kişi", key: "clAssignee", width: 22 },
      { header: "Cl Statü", key: "clStatus", width: 20 },
      { header: "Deploy Çıkacak Kişi", key: "deployPerson", width: 22 },
      { header: "Not", key: "note", width: 30 },
    ];
    ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));

    const LAST_COL = "I";
    const COL_COUNT = columns.length;
    const NAVY = "FF1F3A5F";
    const HEADER = "FF2E5AAC";
    const MANUAL_HEADER = "FF7D4E2D";
    const MANUAL_FILL = "FFFBF3EA";
    const ZEBRA = "FFF3F6FB";
    const BORDER = "FFD5DDE8";

    // 1. satır: Başlık
    ws.mergeCells(`A1:${LAST_COL}1`);
    const titleCell = ws.getCell("A1");
    titleCell.value = "Olka Deploy — Ready for Ship Tasklar";
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
    statsCell.value = `Statü: ${meta.status || "Ready for Ship"}      |      Toplam: ${rows.length}      |      Oluşturulma: ${new Date().toLocaleString("tr-TR")}`;
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
      const isManual = c.key === "deployPerson" || c.key === "note";
      cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isManual ? MANUAL_HEADER : HEADER },
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
      c1.value = r.olkaKey
        ? { text: r.olkaKey, hyperlink: `${OLKA_BASE_URL}/browse/${r.olkaKey}` }
        : "";
      c1.font = { color: { argb: "FF1155CC" }, underline: true, bold: true };

      row.getCell(2).value = r.summary || "";

      const c3 = row.getCell(3);
      c3.value = r.assignee || "Atanmamış";
      if (!r.assignee) c3.font = { color: { argb: "FFAAAAAA" }, italic: true };

      row.getCell(4).value = r.reporter || "—";

      const c5 = row.getCell(5);
      if (r.clKey) {
        c5.value = {
          text: r.clKey,
          hyperlink: `${HEBIAR_BASE_URL}/browse/${r.clKey}`,
        };
        c5.font = { color: { argb: "FF1E8449" }, underline: true };
      } else {
        c5.value = "—";
        c5.font = { color: { argb: "FFAAAAAA" } };
      }

      const c6 = row.getCell(6);
      c6.value = r.clAssignee || "—";
      if (!r.clAssignee)
        c6.font = { color: { argb: "FFAAAAAA" }, italic: true };

      const c7 = row.getCell(7);
      c7.value = r.clStatus || "—";
      if (!r.clStatus) c7.font = { color: { argb: "FFAAAAAA" }, italic: true };

      // 8 (Deploy Çıkacak Kişi) ve 9 (Not) manuel doldurulacak — boş bırakılır.
      row.getCell(8).value = "";
      row.getCell(9).value = "";

      for (let col = 1; col <= COL_COUNT; col++) {
        const cell = row.getCell(col);
        const isManual = col === 8 || col === 9;
        cell.border = {
          top: { style: "hair", color: { argb: BORDER } },
          left: { style: "hair", color: { argb: BORDER } },
          bottom: { style: "hair", color: { argb: BORDER } },
          right: { style: "hair", color: { argb: BORDER } },
        };
        cell.alignment = {
          vertical: "middle",
          horizontal: col === 2 ? "left" : "center",
          wrapText: col === 2 || col === 9,
        };
        if (isManual) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: MANUAL_FILL },
          };
        } else if (zebra) {
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

    // Başlık satırına filtre (CL statü dahil tüm kolonlar filtrelenebilir)
    ws.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: 3, column: COL_COUNT },
    };

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

export default new OlkaDeployReportService();
