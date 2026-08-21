import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import authService from "../auth/service.js";
import { PAGES } from "../auth/constants.js";
import { requireApiWriteAccess } from "./middleware/authorization.js";
import {
  registerProtectedAuthRoutes,
  registerPublicAuthRoutes,
} from "./routes/auth-routes.js";
import { registerDashboardRoutes } from "./routes/dashboard-routes.js";
import { registerReportRoutes } from "./routes/report-routes.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(currentDirectory, "../public");
const assetsDirectory = path.join(currentDirectory, "../../assets");

function registerStaticAssets(app) {
  app.use("/assets", express.static(assetsDirectory));
  app.use(
    express.static(publicDirectory, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache, must-revalidate");
        }
      },
    }),
  );
  app.get("/", (req, res) => {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.sendFile(path.join(publicDirectory, "dashboard.html"));
  });
}

function registerAuthorization(app) {
  app.use("/api", authService.requireAuth);
  const pageRoutes = [
    ["/api/daily-report", PAGES.DAILY],
    ["/api/daily-closed", PAGES.CLOSED],
    ["/api/olka-deploy", PAGES.OLKA_DEPLOY],
    ["/api/rfr", PAGES.RFR],
    ["/api/reject", PAGES.REJECT],
    ["/api/hdv-status", PAGES.HDV_STATUS],
    ["/api/olka-sprint", PAGES.OLKA_SPRINT],
    ["/api/olka-roadmap", PAGES.OLKA_ROADMAP],
    ["/api/label-sync", PAGES.LABEL_SYNC],
    ["/api/mc-board", PAGES.PROJECT_BOARD],
    ["/api/project-report", PAGES.PROJECT_REPORT],
    ["/api/create-task", PAGES.CREATE_TASK],
    ["/api/projects", PAGES.CREATE_TASK],
    ["/api/all-sprints", PAGES.CREATE_TASK],
    ["/api/users", PAGES.CREATE_TASK],
    ["/api/tenant-projects", PAGES.TENANT_MANAGEMENT],
  ];
  pageRoutes.forEach(([route, page]) => {
    app.use(route, authService.requirePageAccess(page));
  });
  app.use("/api", requireApiWriteAccess);
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  registerStaticAssets(app);
  registerPublicAuthRoutes(app);
  registerAuthorization(app);
  registerProtectedAuthRoutes(app);
  registerDashboardRoutes(app);
  registerReportRoutes(app);
  return app;
}

export default createApp;
