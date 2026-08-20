import authService from "../../auth/service.js";
import { COMPANY_LOGIN_TENANTS } from "../../auth/constants.js";
import { normalizeTenant } from "../../auth/normalization.js";

function tenantSelectionResponse(res, result) {
  const flow = authService.createCompanyTenantFlow(result.tenants);
  res.cookie(
    authService.companyTenantFlowCookie,
    flow.token,
    authService.cookieOptions(flow.maxAge),
  );
  return res.json({
    authenticated: false,
    requiresTenant: true,
    tenants: result.tenants,
  });
}

function getCompanyLoginContext(req, result) {
  const cookies = authService.getRequestCookies(req);
  const selectedTenant = req.body?.tenant;
  const normalizedTenant = normalizeTenant(selectedTenant);
  const allowedTenants = selectedTenant
    ? authService.getCompanyTenantFlow(
        cookies[authService.companyTenantFlowCookie],
      )
    : [result.identity.tenant].filter(Boolean);
  return { cookies, selectedTenant, normalizedTenant, allowedTenants };
}

function completeCompanyLogin(res, result, context, maxAge) {
  const { cookies, allowedTenants } = context;
  const tenantOptions = [...new Set([...(allowedTenants || []), "HDV"])];
  authService.registerCompanySession(
    result.token,
    tenantOptions,
    result.identity.expiresAt,
  );
  authService.deleteCompanyTenantFlow(
    cookies[authService.companyTenantFlowCookie],
  );
  res.clearCookie(authService.localCookie, authService.cookieOptions(0));
  res.cookie(
    authService.companyCookie,
    result.token,
    authService.cookieOptions(maxAge),
  );
  res.clearCookie(
    authService.companyTenantFlowCookie,
    authService.cookieOptions(0),
  );
  res.json({ authenticated: true, user: result.identity });
}

export async function companyLogin(req, res) {
  try {
    const result = await authService.companyLogin(req.body || {});
    if (!req.body?.tenant) {
      return tenantSelectionResponse(res, {
        tenants: COMPANY_LOGIN_TENANTS,
      });
    }
    if (result.kind === "tenant") return tenantSelectionResponse(res, result);
    const expiry = new Date(result.identity.expiresAt || 0).getTime();
    const maxAge = Math.max(0, expiry - Date.now());
    if (!Number.isFinite(maxAge) || maxAge <= 0) {
      return res.status(401).json({ error: "Giriş token'ının süresi dolmuş" });
    }
    const context = getCompanyLoginContext(req, result);
    if (
      context.selectedTenant &&
      (!context.allowedTenants ||
        !context.allowedTenants.includes(context.normalizedTenant))
    ) {
      return res.status(403).json({
        error: "Seçilen tenant CommerceLab giriş akışında bulunmuyor",
      });
    }
    completeCompanyLogin(res, result, context, maxAge);
  } catch (error) {
    authService.sendError(res, error);
  }
}

export function localLogin(req, res) {
  try {
    const result = authService.localLogin(req.body || {});
    if (result.kind === "tenant") {
      return res.json({
        authenticated: false,
        requiresTenant: true,
        tenants: result.tenants,
      });
    }
    res.clearCookie(authService.companyCookie, authService.cookieOptions(0));
    res.cookie(
      authService.localCookie,
      result.token,
      authService.cookieOptions(result.maxAge),
    );
    res.json({ authenticated: true, user: result.identity });
  } catch (error) {
    authService.sendError(res, error);
  }
}

export function logout(req, res) {
  authService.logout(req, res);
  res.status(204).end();
}

export function currentUser(req, res) {
  res.json({ user: req.auth });
}

export function listUsers(req, res) {
  try {
    res.json({ users: authService.listUsers(req.auth) });
  } catch (error) {
    authService.sendError(res, error);
  }
}

export function createUser(req, res) {
  try {
    const user = authService.createUser(req.auth, req.body || {});
    res.status(201).json({ user });
  } catch (error) {
    authService.sendError(res, error);
  }
}

export function deleteUser(req, res) {
  try {
    authService.deleteUser(req.auth, req.params.userId);
    res.status(204).end();
  } catch (error) {
    authService.sendError(res, error);
  }
}
