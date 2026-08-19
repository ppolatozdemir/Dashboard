import axios from "axios";
import { getConfig } from "./config.js";

/**
 * "Proje Raporu" raporu:
 * Hebiar (Commercelab) Jira'sındaki weekly board'un (54) bir sprintini alır ve
 * o sprintte HANGİ PROJEDEN KAÇ TASK alındığını hem sayı hem yüzde olarak döner.
 *
 * Sprint listesi: board 54'ün aktif + future + (en yeni) kapanan sprintleri.
 * MC Sprint 1 sızıntısını önlemek için YALNIZCA originBoardId===54 olan sprintler alınır.
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
const CLOSED_SPRINT_LIMIT = parseInt(
  process.env.PROJECT_REPORT_CLOSED_LIMIT || "40",
  10,
);

// Tamamlanmış sayılan statüler (küçük harf). Bunlara ek olarak "Tamamlandı" (Done)
// kategorisindeki her statü de tamamlanmış kabul edilir (Onlive, Tamam vb.).
const COMPLETED_STATUSES = new Set(
  (
    process.env.PROJECT_REPORT_COMPLETED_STATUSES ||
    "ready for release,merge,merged,qa testing,test"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

class ProjectReportService {
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
   * Weekly board'un belirtilen state'teki tüm sprintlerini (sayfalı) çeker.
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
   * Board 54'ün kendi filtresi uygulanır (board-scoped endpoint) — böylece
   * sprinte atanmış ama weekly board filtresine UYMAYAN maddeler (ör. eski MC
   * carryover'ları) sayılmaz; sonuç Jira'daki weekly sprint görünümüyle eşleşir.
   */
  async _fetchAllSprintIssues(sprintId, fields) {
    const headers = this.getAuthHeader();
    let startAt = 0;
    let total = Infinity;
    const all = [];

    while (startAt < total) {
      const res = await axios.get(
        `${HEBIAR_BASE_URL}/rest/agile/1.0/board/${HEBIAR_WEEKLY_BOARD_ID}/sprint/${sprintId}/issue`,
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

  _tsOf(s) {
    const d = s.completeDate || s.endDate || s.startDate;
    return d ? new Date(d).getTime() : 0;
  }

  /**
   * Bir issue tamamlanmış mı? (küçük-harf statü adı listede VEYA statusCategory=done)
   */
  isCompleted(statusName, statusCategoryKey) {
    const name = (statusName || "").trim().toLowerCase();
    return COMPLETED_STATUSES.has(name) || statusCategoryKey === "done";
  }

  /**
   * Sprint seçim listesi: aktif > future > (en yeni) kapanan.
   * Sadece board 54'ten doğan (originBoardId===54) sprintler döner.
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
   * Verilen sprint için proje bazlı task kırılımını (sayı + yüzde) döner.
   * sprintId verilmezse ilk (aktif ya da en yeni) sprint kullanılır.
   */
  async getBreakdown(sprintId) {
    const sprints = await this.getSprints();

    let target = sprintId
      ? sprints.find((s) => String(s.id) === String(sprintId))
      : sprints[0];
    if (!target) target = sprints[0];

    if (!target) {
      return {
        sprint: null,
        sprints,
        total: 0,
        completed: 0,
        remaining: 0,
        completionRate: 0,
        projects: [],
      };
    }

    const issues = await this._fetchAllSprintIssues(target.id, [
      "project",
      "status",
    ]);

    const map = this._groupProjects(issues);
    const total = issues.length;
    const completed = [...map.values()].reduce((a, p) => a + p.completed, 0);
    return {
      sprint: {
        id: target.id,
        name: target.name,
        state: target.state,
        startDate: target.startDate || null,
        endDate: target.endDate || null,
        completeDate: target.completeDate || null,
      },
      sprints,
      total,
      completed,
      remaining: total - completed,
      completionRate:
        total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
      projects: this._projectPercentages(map, total),
    };
  }

  _groupProjects(issues) {
    const projects = new Map();
    for (const issue of issues) {
      const fields = issue.fields || {};
      const project = fields.project || null;
      const key = project ? project.key : "—";
      const name = project ? project.name : "Bilinmiyor";
      const statusName = fields.status ? fields.status.name : "";
      const category = fields.status?.statusCategory?.key || null;
      const current = projects.get(key) || {
        key,
        name,
        count: 0,
        completed: 0,
      };
      current.count += 1;
      if (this.isCompleted(statusName, category)) current.completed += 1;
      projects.set(key, current);
    }
    return projects;
  }

  _projectPercentages(projectMap, total) {
    return [...projectMap.values()]
      .map((project) => ({
        ...project,
        remaining: project.count - project.completed,
        percentage:
          total > 0 ? Math.round((project.count / total) * 1000) / 10 : 0,
        completionRate:
          project.count > 0
            ? Math.round((project.completed / project.count) * 1000) / 10
            : 0,
      }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }

  /**
   * Kırılımı renkli başlıklı, yüzdeli bir .xlsx dosyası olarak üretir.
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

    const sprintName = data.sprint ? data.sprint.name : "—";
    const total = data.total || 0;
    const completed = data.completed || 0;
    const completionRate = data.completionRate || 0;
    const projects = Array.isArray(data.projects) ? data.projects : [];

    const ws = workbook.addWorksheet("Proje Kırılımı", {
      pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1 },
    });
    ws.columns = [
      { width: 34 },
      { width: 12 },
      { width: 12 },
      { width: 13 },
      { width: 15 },
      { width: 11 },
    ];

    ws.mergeCells("A1:F1");
    const t1 = ws.getCell("A1");
    t1.value = "Proje Raporu — Sprint Bazlı Task Kırılımı";
    t1.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    t1.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    t1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    ws.getRow(1).height = 30;

    ws.mergeCells("A2:F2");
    const t2 = ws.getCell("A2");
    t2.value = `Sprint: ${sprintName}      |      Toplam: ${total}      |      Tamamlanan: ${completed} (%${completionRate})      |      Oluşturulma: ${new Date().toLocaleString("tr-TR")}`;
    t2.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
    t2.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    t2.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEAF0FA" },
    };
    ws.getRow(2).height = 18;

    const headers = [
      "Proje",
      "Proje Kodu",
      "Task Sayısı",
      "Tamamlanan",
      "Tamamlanma %",
      "Yüzde",
    ];
    const headerRowIdx = 4;
    headers.forEach((h, i) => {
      const cell = ws.getCell(headerRowIdx, i + 1);
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
    ws.getRow(headerRowIdx).height = 20;

    let r = headerRowIdx + 1;
    projects.forEach((p, idx) => {
      const cells = [
        p.name,
        p.key,
        p.count,
        p.completed,
        `%${p.completionRate}`,
        `%${p.percentage}`,
      ];
      cells.forEach((v, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = v;
        cell.font = { size: 11 };
        cell.alignment = {
          vertical: "middle",
          horizontal: i === 0 ? "left" : "center",
          indent: i === 0 ? 1 : 0,
        };
        if (idx % 2 === 1) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: ZEBRA },
          };
        }
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

    const totalCells = [
      "TOPLAM",
      "",
      total,
      completed,
      `%${completionRate}`,
      "%100",
    ];
    totalCells.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = v;
      cell.font = { bold: true, size: 11, color: { argb: "FF1F2937" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: TOTAL_FILL },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: i === 0 ? "left" : "center",
        indent: i === 0 ? 1 : 0,
      };
      cell.border = {
        top: { style: "medium", color: { argb: HEADER } },
        bottom: { style: "thin", color: { argb: BORDER } },
      };
    });
    ws.getRow(r).height = 20;

    ws.autoFilter = {
      from: { row: headerRowIdx, column: 1 },
      to: { row: headerRowIdx, column: 6 },
    };
    ws.views = [{ state: "frozen", ySplit: headerRowIdx }];

    return workbook.xlsx.writeBuffer();
  }
}

export default new ProjectReportService();
