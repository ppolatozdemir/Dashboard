import {
  companyLogin,
  createUser,
  currentUser,
  deleteUser,
  listUsers,
  localLogin,
  requestPasswordReset,
  resetPassword,
  logout,
  switchTenant,
  updateUser,
  verifyPasswordReset,
} from "../controllers/auth-controller.js";

export function registerPublicAuthRoutes(app) {
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
  app.post("/api/auth/commercelab/login", companyLogin);
  app.post("/api/auth/local/login", localLogin);
  app.post("/api/auth/logout", logout);
  app.post("/api/auth/password-reset/request", requestPasswordReset);
  app.post("/api/auth/password-reset/verify", verifyPasswordReset);
  app.post("/api/auth/password-reset/reset", resetPassword);
}

export function registerProtectedAuthRoutes(app) {
  app.get("/api/auth/me", currentUser);
  app.post("/api/auth/tenant", switchTenant);
  app.get("/api/auth/users", listUsers);
  app.post("/api/auth/users", createUser);
  app.patch("/api/auth/users/:userId", updateUser);
  app.put("/api/auth/users/:userId", updateUser);
  app.delete("/api/auth/users/:userId", deleteUser);
}
