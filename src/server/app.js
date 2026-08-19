import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import authService from "../auth/service.js";
import { requireApiWriteAccess } from "./middleware/authorization.js";
import {
  registerProtectedAuthRoutes,
  registerPublicAuthRoutes,
} from "./routes/auth-routes.js";
import { registerDashboardRoutes } from "./routes/dashboard-routes.js";
import { registerReportRoutes } from "./routes/report-routes.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(currentDirectory, "../public");

function registerStaticAssets(app) {
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
  app.use("/api/mc-board", authService.requireTenantAccess("MCC"));
  app.use("/api/hdv-status", authService.requireTenantAccess("HDV"));
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
