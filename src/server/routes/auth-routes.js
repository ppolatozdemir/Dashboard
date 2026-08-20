import {
  companyLogin,
  createUser,
  currentUser,
  deleteUser,
  listUsers,
  localLogin,
  logout,
  switchTenant,
} from "../controllers/auth-controller.js";

export function registerPublicAuthRoutes(app) {
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
  app.post("/api/auth/commercelab/login", companyLogin);
  app.post("/api/auth/local/login", localLogin);
  app.post("/api/auth/logout", logout);
}

export function registerProtectedAuthRoutes(app) {
  app.get("/api/auth/me", currentUser);
  app.post("/api/auth/tenant", switchTenant);
  app.get("/api/auth/users", listUsers);
  app.post("/api/auth/users", createUser);
  app.delete("/api/auth/users/:userId", deleteUser);
}
