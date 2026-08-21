import * as reports from "../controllers/report-controller.js";

export function registerReportRoutes(app) {
  app.get("/api/olka-deploy/report", reports.olkaDeployReport);
  app.post("/api/olka-deploy/export", reports.exportOlkaDeploy);
  app.get("/api/rfr/report", reports.rfrReport);
  app.post("/api/rfr/export", reports.exportRfr);
  app.get("/api/reject/report", reports.rejectReport);
  app.post("/api/reject/export", reports.exportReject);
  app.get("/api/hdv-status/report", reports.hdvStatusReport);
  app.post("/api/hdv-status/export", reports.exportHdvStatus);
  app.get("/api/olka-sprint/report", reports.olkaSprintReport);
  app.post("/api/olka-sprint/export", reports.exportOlkaSprint);
  app.get("/api/project-report/sprints", reports.projectReportSprints);
  app.get("/api/project-report/breakdown", reports.projectReportBreakdown);
  app.post("/api/project-report/export", reports.exportProjectReport);
  app.post("/api/label-sync/run", reports.syncLabels);
  app.get("/api/mc-board/report", reports.mcBoardReport);
  app.get("/api/mc-board/projects", reports.tenantBoardProjects);
  app.get("/api/olka-roadmap/report", reports.olkaRoadmapReport);
  app.post("/api/olka-roadmap/export", reports.exportOlkaRoadmap);
}
