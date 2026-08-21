import {
  dateStamp,
  requireConfiguration,
  sendXlsx,
  validateRows,
} from "./controller-utils.js";
import { taskProjectKeysFor } from "../../auth/task-policy.js";
import { AuthError } from "../../auth/error.js";

function authorizedProjectKeys(req) {
  return taskProjectKeysFor(req.auth);
}

function authorizeBoardProject(req, projectKey) {
  const allowed = authorizedProjectKeys(req);
  const normalized = String(projectKey || "").trim().toUpperCase();
  if (!normalized || !allowed.includes(normalized)) {
    throw new AuthError(403, "Seçilen proje aktif tenantınız için yetkili değil");
  }
  return normalized;
}

async function runConfigured(res, label, operation) {
  if (!requireConfiguration(res)) return;
  try {
    await operation();
  } catch (error) {
    console.error(`${label}:`, error.message);
    res.status(error.status || 500).json({ error: error.message });
  }
}

export function olkaUnsprintedSprints(req, res) {
  return runConfigured(res, "Olka sprint listesi hatası", async () => {
    const service = (await import("../../lib/unsprinted-report.js")).default;
    res.json(await service.getOlkaSprints());
  });
}

export function hebiarUnsprintedSprints(req, res) {
  return runConfigured(res, "Hebiar sprint listesi hatası", async () => {
    const service = (await import("../../lib/unsprinted-report.js")).default;
    res.json(await service.getHebiarSprints());
  });
}

export function unsprintedReport(req, res) {
  return runConfigured(res, "Sprinte alınmayan rapor hatası", async () => {
    const { olkaSprintId, hebiarSprintId } = req.query;
    if (!olkaSprintId || !hebiarSprintId) {
      return res
        .status(400)
        .json({ error: "Olka ve Hebiar sprint seçimi zorunludur" });
    }
    const service = (await import("../../lib/unsprinted-report.js")).default;
    res.json(await service.getUnsprintedTasks(olkaSprintId, hebiarSprintId));
  });
}

export function exportUnsprinted(req, res) {
  return runConfigured(res, "Sprinte alınmayan Excel export hatası", async () => {
    const { rows, olkaSprintName, hebiarSprintName, olkaTotal, hebiarTotal } =
      req.body || {};
    if (!validateRows(res, rows)) return;
    const service = (await import("../../lib/unsprinted-report.js")).default;
    const buffer = await service.buildUnsprintedXlsxBuffer(rows, {
      olkaSprintName,
      hebiarSprintName,
      olkaTotal,
      hebiarTotal,
    });
    const safe = (text) =>
      (text || "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
    const filename = `sprinte-alinmayan_${safe(olkaSprintName) || "olka"}_vs_${safe(hebiarSprintName) || "hebiar"}_${dateStamp()}.xlsx`;
    sendXlsx(res, buffer, filename);
  });
}

export function olkaDeployReport(req, res) {
  return runConfigured(res, "Olka Deploy rapor hatası", async () => {
    const service = (await import("../../lib/olka-deploy-report.js")).default;
    res.json(await service.getDeployTasks());
  });
}

export function exportOlkaDeploy(req, res) {
  return runConfigured(res, "Olka Deploy Excel export hatası", async () => {
    const { rows, status } = req.body || {};
    if (!validateRows(res, rows)) return;
    const service = (await import("../../lib/olka-deploy-report.js")).default;
    const buffer = await service.buildOlkaDeployXlsxBuffer(rows, { status });
    sendXlsx(res, buffer, `olka-deploy_ready-for-ship_${dateStamp()}.xlsx`);
  });
}

export function rfrReport(req, res) {
  return runConfigured(res, "RFR Takip rapor hatası", async () => {
    const service = (await import("../../lib/rfr-report.js")).default;
    res.json(await service.getRfrTasks());
  });
}

export function exportRfr(req, res) {
  return runConfigured(res, "RFR Takip Excel export hatası", async () => {
    const { rows, status, overdueDays } = req.body || {};
    if (!validateRows(res, rows)) return;
    const service = (await import("../../lib/rfr-report.js")).default;
    const buffer = await service.buildRfrXlsxBuffer(rows, {
      status,
      overdueDays,
    });
    sendXlsx(res, buffer, `rfr-takip_ready-for-release_${dateStamp()}.xlsx`);
  });
}

export function rejectReport(req, res) {
  return runConfigured(res, "Reject Takip rapor hatası", async () => {
    const service = (await import("../../lib/reject-report.js")).default;
    res.json(await service.getRejectTasks(authorizedProjectKeys(req)));
  });
}

export function exportReject(req, res) {
  return runConfigured(res, "Reject Takip Excel export hatası", async () => {
    const { rows, statuses } = req.body || {};
    if (!validateRows(res, rows)) return;
    const allowedProjectKeys = new Set(authorizedProjectKeys(req));
    const scopedRows = rows.filter((row) =>
      allowedProjectKeys.has(String(row.projectKey || "").trim().toUpperCase()),
    );
    const service = (await import("../../lib/reject-report.js")).default;
    const buffer = await service.buildRejectXlsxBuffer(scopedRows, {
      statuses,
      projectCount: new Set(scopedRows.map((row) => row.projectKey)).size,
    });
    sendXlsx(res, buffer, `reject-takip_${dateStamp()}.xlsx`);
  });
}

export function hdvStatusReport(req, res) {
  return runConfigured(res, "HDV Son Durum rapor hatası", async () => {
    const service = (await import("../../lib/hdv-status-report.js")).default;
    res.json(await service.getHdvStatusTasks());
  });
}

export function exportHdvStatus(req, res) {
  return runConfigured(res, "HDV Son Durum Excel export hatası", async () => {
    const { rows } = req.body || {};
    if (!validateRows(res, rows)) return;
    const service = (await import("../../lib/hdv-status-report.js")).default;
    const buffer = await service.buildHdvStatusXlsxBuffer(rows);
    sendXlsx(res, buffer, `hdv-son-durum_${dateStamp()}.xlsx`);
  });
}

export function olkaSprintReport(req, res) {
  return runConfigured(res, "Sprint Raporu hatası", async () => {
    const service = (await import("../../lib/olka-sprint-report.js")).default;
    res.json(await service.getSprintReport(req.query.sprintId));
  });
}

export function exportOlkaSprint(req, res) {
  return runConfigured(res, "Sprint Raporu Excel export hatası", async () => {
    const data = req.body || {};
    if (!data.stats || !Array.isArray(data.rows)) {
      return res.status(400).json({
        error: "Geçersiz veri: rapor verisi (stats + rows) gerekli",
      });
    }
    const service = (await import("../../lib/olka-sprint-report.js")).default;
    const buffer = await service.buildXlsxBuffer(data);
    const sprintName = (
      data.sprint && data.sprint.name ? data.sprint.name : "sprint"
    ).replace(/[^a-z0-9]+/gi, "-");
    sendXlsx(
      res,
      buffer,
      `olka-sprint-rapor_${sprintName}_${dateStamp()}.xlsx`,
    );
  });
}

export function projectReportSprints(req, res) {
  return runConfigured(res, "Proje Raporu sprint listesi hatası", async () => {
    const service = (await import("../../lib/project-report.js")).default;
    res.json(await service.getSprints());
  });
}

export function projectReportBreakdown(req, res) {
  return runConfigured(res, "Proje Raporu kırılım hatası", async () => {
    const service = (await import("../../lib/project-report.js")).default;
    res.json(await service.getBreakdown(req.query.sprintId, authorizedProjectKeys(req)));
  });
}

export function exportProjectReport(req, res) {
  return runConfigured(res, "Proje Raporu Excel export hatası", async () => {
    const sprintId = req.body?.sprintId;
    if (!sprintId) {
      return res.status(400).json({
        error: "Sprint seçimi gerekli",
      });
    }
    const service = (await import("../../lib/project-report.js")).default;
    const data = await service.getBreakdown(sprintId, authorizedProjectKeys(req));
    const buffer = await service.buildXlsxBuffer(data);
    const sprintName = (
      data.sprint && data.sprint.name ? data.sprint.name : "sprint"
    ).replace(/[^a-z0-9]+/gi, "-");
    sendXlsx(res, buffer, `proje-raporu_${sprintName}_${dateStamp()}.xlsx`);
  });
}

export function syncLabels(req, res) {
  return runConfigured(res, "Etiket eşitleme hatası", async () => {
    const dryRun = req.body?.dryRun === true;
    const service = (await import("../../lib/label-sync-report.js")).default;
    const logLines = [];
    try {
      const result = await service.syncLabels({
        dryRun,
        onLog: (message) => logLines.push(message),
      });
      res.json({ ...result, logLines });
    } catch (error) {
      const status = /zaten çalışıyor/i.test(error.message) ? 409 : 500;
      console.error("Etiket eşitleme hatası:", error.message);
      res.status(status).json({ error: error.message });
    }
  });
}

export function mcBoardReport(req, res) {
  return runConfigured(res, "MC Panosu rapor hatası", async () => {
    const service = (await import("../../lib/mc-board-report.js")).default;
    const projectKey = authorizeBoardProject(req, req.query.projectKey);
    res.json(await service.getBoardData(projectKey));
  });
}

export function tenantBoardProjects(req, res) {
  return runConfigured(res, "Tenant pano proje listesi hatası", async () => {
    const projectKeys = authorizedProjectKeys(req);
    res.json({ projectKeys });
  });
}

export function olkaRoadmapReport(req, res) {
  return runConfigured(res, "Olka Roadmap rapor hatası", async () => {
    const service = (await import("../../lib/olka-roadmap-report.js")).default;
    res.json(await service.getReport());
  });
}

export function exportOlkaRoadmap(req, res) {
  return runConfigured(res, "Olka Roadmap Excel export hatası", async () => {
    const data = req.body || {};
    if (
      !validateRows(
        res,
        data.rows,
        "Geçersiz veri: madde listesi (rows) gerekli",
      )
    ) {
      return;
    }
    const service = (await import("../../lib/olka-roadmap-report.js")).default;
    const buffer = await service.buildXlsxBuffer(data);
    const periodSlug = (data.periodLabel || "roadmap").replace(
      /[^a-z0-9]+/gi,
      "-",
    );
    sendXlsx(res, buffer, `olka-roadmap_${periodSlug}_${dateStamp()}.xlsx`);
  });
}
