import axios from "axios";
import { getConfig } from "./config.js";

/**
 * "Reject Takip" raporu:
 * Hebiar (Commercelab) Jira'sında statüsü "Reject" / "REJECT" veya "Returned"
 * olan maddeleri, HDV (HDHOLDING) projesi HARİÇ tüm projelerde listeler ve PROJE
 * bazında gruplar. Sol panelde proje listesi, sağda seçilen projenin maddeleri.
 *
 * Not: Hebiar sabit URL'dir; config.baseUrl Olka'yı göstersede bile bu rapor daima
 * Hebiar'a bağlanır (HEBIAR_BASE_URL ile override edilebilir).
 */

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
// Hariç tutulacak proje anahtar(lar)ı (varsayılan: HDV). Virgülle çoğaltılabilir.
const EXCLUDED_PROJECTS = (process.env.REJECT_EXCLUDE_PROJECTS || "HDV")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Rapora dahil edilecek statüler: adı bu desene uyanlar. Varsayılan olarak
// "Reject"/"REJECT" ve "Returned"/"Return" statüleri kapsanır. Env ile
// override edilebilir (ör. REJECT_STATUS_PATTERN="reject|return|iptal").
const STATUS_PATTERN = new RegExp(
  process.env.REJECT_STATUS_PATTERN || "reject|return",
  "i",
);
// Statü API'si erişilemezse kullanılacak güvenli varsayılan statü adları.
const FALLBACK_STATUSES = ["Reject", "REJECT", "Returned"];

class RejectReportService {
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
    } while (nextPageToken && pages < 60);

    return all;
  }

  /**
   * Hebiar'daki "reject" içeren tüm statü adlarını bulur. Instance'ta hem
   * "Reject" hem "REJECT" gibi farklı yazımlar olabildiğinden statüler dinamik
   * keşfedilir. Bulunamazsa güvenli varsayılana (Reject/REJECT/Returned) düşer.
   */
  async _getRejectStatusNames() {
    try {
      const headers = this.getAuthHeader();
      const res = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/status`, {
        headers,
      });
      const names = (res.data || [])
        .map((s) => s.name)
        .filter((n) => STATUS_PATTERN.test(n || ""));
      const uniq = [...new Set(names)];
      return uniq.length ? uniq : [...FALLBACK_STATUSES];
    } catch (err) {
      return [...FALLBACK_STATUSES];
    }
  }

  /**
   * Hebiar'daki (kullanıcının görebildiği) TÜM projeleri çeker. HDV hariç.
   * project/search endpoint'i startAt tabanlı sayfalıdır (isLast'a kadar döner).
   * Sol panelde reject'i olmayan projeler de (0 sayısıyla) görünsün diye kullanılır.
   */
  async _getAllProjects() {
    const headers = this.getAuthHeader();
    const all = [];
    let startAt = 0;
    const maxResults = 50;

    for (let page = 0; page < 60; page++) {
      const res = await axios.get(
        `${HEBIAR_BASE_URL}/rest/api/3/project/search`,
        { params: { startAt, maxResults, orderBy: "name" }, headers },
      );
      const values = res.data.values || [];
      all.push(...values);
      if (res.data.isLast || values.length === 0) break;
      startAt += values.length;
    }

    return all
      .map((p) => ({ key: p.key, name: p.name || p.key }))
      .filter((p) => !EXCLUDED_PROJECTS.includes(p.key));
  }

  /**
   * Statüsü reddedilen/iade edilen (Reject/REJECT/Returned) Hebiar maddelerini,
   * HDV hariç tüm projelerden çeker ve proje bazlı özet + satır listesi döner.
   */
  async getRejectTasks() {
    const fields = [
      "summary",
      "status",
      "assignee",
      "project",
      "issuetype",
      "priority",
      "created",
      "updated",
    ];

    const statusNames = await this._getRejectStatusNames();
    const statusClause = statusNames.map((n) => `"${n}"`).join(", ");
    const excludeClause = EXCLUDED_PROJECTS.map((p) => `"${p}"`).join(", ");

    const baseJql = `status in (${statusClause}) AND project not in (${excludeClause})`;
    const jql = `${baseJql} ORDER BY project ASC, key ASC`;

    let issues;
    try {
      issues = await this._searchAllJql(jql, fields);
    } catch (err) {
      // Sıralama JQL'de sorun çıkarırsa sade sorgu ile tekrar dene.
      issues = await this._searchAllJql(baseJql, fields);
    }

    const rows = issues.map((issue) => this._mapRejectIssue(issue));

    // Proje adına göre (Türkçe) sırala; aynı projede key'e göre.
    rows.sort((a, b) => {
      const c = (a.projectName || "").localeCompare(b.projectName || "", "tr");
      if (c !== 0) return c;
      return (a.key || "").localeCompare(b.key || "", "tr", { numeric: true });
    });

    // Proje bazlı özet — sol panelde Hebiar'daki TÜM projeler (HDV hariç)
    // görünsün diye önce tüm projeler 0 ile eklenir, sonra reject sayıları işlenir.
    let allProjects = [];
    try {
      allProjects = await this._getAllProjects();
    } catch (err) {
      allProjects = [];
    }

    const projects = this._summarizeProjects(allProjects, rows);
    const rejectProjectCount = projects.filter((p) => p.count > 0).length;

    return {
      statuses: statusNames,
      excludedProjects: EXCLUDED_PROJECTS,
      count: rows.length,
      projectCount: projects.length,
      rejectProjectCount,
      generatedAt: new Date().toISOString(),
      projects,
      rows,
    };
  }

  _mapRejectIssue(issue) {
    const fields = issue.fields || {};
    const project = fields.project || {};
    return {
      key: issue.key,
      summary: fields.summary || "",
      assignee: fields.assignee ? fields.assignee.displayName : null,
      statusName: fields.status ? fields.status.name : "Reject",
      projectKey: project.key || "?",
      projectName: project.name || project.key || "?",
      issueType: fields.issuetype ? fields.issuetype.name : null,
      priority: fields.priority ? fields.priority.name : null,
      created: fields.created || null,
      updated: fields.updated || null,
    };
  }

  _summarizeProjects(allProjects, rows) {
    const projects = new Map();
    for (const project of allProjects) {
      projects.set(project.key, {
        key: project.key,
        name: project.name,
        count: 0,
      });
    }
    for (const row of rows) {
      if (!projects.has(row.projectKey)) {
        projects.set(row.projectKey, {
          key: row.projectKey,
          name: row.projectName,
          count: 0,
        });
      }
      projects.get(row.projectKey).count++;
    }
    return [...projects.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, "tr"),
    );
  }

  /**
   * Verilen satırlardan şablonlu (renkli başlık, kenarlıklar, task linki, filtre)
   * bir .xlsx üretir ve Buffer döner. Türkçe karakterler tam desteklenir.
   */
  async buildRejectXlsxBuffer(rows = [], meta = {}) {
    const ExcelJS = (await import("exceljs")).default;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PolatAi Dashboard";
    workbook.created = new Date();

    const ws = workbook.addWorksheet("Reject Takip", {
      views: [{ state: "frozen", ySplit: 3 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    const columns = [
      { header: "Proje", key: "projectName", width: 22 },
      { header: "Task Kodu", key: "key", width: 15 },
      { header: "Task Özet", key: "summary", width: 58 },
      { header: "Atanan Kişi", key: "assignee", width: 24 },
      { header: "Statü", key: "statusName", width: 14 },
      { header: "Oluşturulma Tarihi", key: "created", width: 20 },
      { header: "Son Güncelleme", key: "updated", width: 20 },
    ];
    ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));

    const LAST_COL = "G";
    const COL_COUNT = columns.length;
    const NAVY = "FF7A1F2B";
    const HEADER = "FFB4232F";
    const ZEBRA = "FFFBF3F4";
    const BORDER = "FFE8D5D8";

    // 1. satır: Başlık
    ws.mergeCells(`A1:${LAST_COL}1`);
    const titleCell = ws.getCell("A1");
    titleCell.value = "Reject Takip — Reddedilen / İade Edilen Maddeler (HDV Hariç)";
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
    const statusText = (meta.statuses || ["Reject"]).join(", ");
    statsCell.value = `Statü: ${statusText}      |      Toplam: ${rows.length}      |      Proje: ${meta.projectCount ?? "-"}      |      Oluşturulma: ${new Date().toLocaleString("tr-TR")}`;
    statsCell.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
    statsCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    statsCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF7E9EB" },
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

      row.getCell(1).value = r.projectName || r.projectKey || "";

      const c2 = row.getCell(2);
      c2.value = r.key
        ? { text: r.key, hyperlink: `${HEBIAR_BASE_URL}/browse/${r.key}` }
        : "";
      c2.font = { color: { argb: "FF1155CC" }, underline: true, bold: true };

      row.getCell(3).value = r.summary || "";

      const c4 = row.getCell(4);
      c4.value = r.assignee || "Atanmamış";
      if (!r.assignee) c4.font = { color: { argb: "FFAAAAAA" }, italic: true };

      row.getCell(5).value = r.statusName || "Reject";

      const c6 = row.getCell(6);
      if (r.created) {
        c6.value = new Date(r.created);
        c6.numFmt = "dd.mm.yyyy hh:mm";
      } else {
        c6.value = "—";
        c6.font = { color: { argb: "FFAAAAAA" } };
      }

      const c7 = row.getCell(7);
      if (r.updated) {
        c7.value = new Date(r.updated);
        c7.numFmt = "dd.mm.yyyy hh:mm";
      } else {
        c7.value = "—";
        c7.font = { color: { argb: "FFAAAAAA" } };
      }

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

    // Başlık satırına filtre (proje/statü Excel'de de filtrelenebilir)
    ws.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: 3, column: COL_COUNT },
    };

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

export default new RejectReportService();
