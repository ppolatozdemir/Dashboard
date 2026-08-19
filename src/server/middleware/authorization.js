import authService from "../../auth/service.js";

export function requireApiWriteAccess(req, res, next) {
  const readOnlyMethod = ["GET", "HEAD", "OPTIONS"].includes(req.method);
  const readOnlyPost =
    req.method === "POST" &&
    (/\/export$/.test(req.path) ||
      (req.path === "/label-sync/run" && req.body?.dryRun === true));
  if (!readOnlyMethod && !readOnlyPost) {
    return authService.requireWrite(req, res, next);
  }
  next();
}
