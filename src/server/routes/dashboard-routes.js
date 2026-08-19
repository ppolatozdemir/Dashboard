import * as dashboard from "../controllers/dashboard-controller.js";
import { createTask } from "../controllers/task-controller.js";

export function registerDashboardRoutes(app) {
  app.get("/api/config/status", dashboard.configStatus);
  app.get("/api/projects", dashboard.projects);
  app.get("/api/people/:projectKey", dashboard.people);
  app.get("/api/daily-report", dashboard.dailyReport);
  app.get("/api/daily-closed", dashboard.dailyClosed);
  app.get("/api/sprint-report/:projectKey", dashboard.sprintReport);
  app.post("/api/sprint-alerts/:projectKey", dashboard.sprintAlerts);
  app.get("/api/report/:projectKey", dashboard.fullReport);
  app.get("/api/stats/:projectKey", dashboard.stats);
  app.get("/api/longest/:projectKey", dashboard.longest);
  app.get("/api/fastest/:projectKey", dashboard.fastest);
  app.get("/api/reporters/:projectKey", dashboard.reporters);
  app.get("/api/resolvers/:projectKey", dashboard.resolvers);
  app.get("/api/users", dashboard.jiraUsers);
  app.get("/api/sprints", dashboard.sprints);
  app.get("/api/all-sprints", dashboard.allSprints);
  app.post("/api/create-task", createTask);
}
