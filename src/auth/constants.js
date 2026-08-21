export const ROLES = Object.freeze({
  OWNER_ADMIN: "OwnerAdmin",
  TENANT_ADMIN: "TenantAdmin",
});

export const GLOBAL_ACCESS_TENANT = "CL";

export const PAGES = Object.freeze({
  DAILY: "daily",
  CLOSED: "closed",
  UNSPRINTED: "unsprinted",
  OLKA_DEPLOY: "olkaDeploy",
  RFR: "rfr",
  REJECT: "reject",
  HDV_STATUS: "hdvStatus",
  OLKA_SPRINT: "olkaSprint",
  OLKA_ROADMAP: "olkaRoadmap",
  LABEL_SYNC: "labelSync",
  PROJECT_BOARD: "mcBoard",
  PROJECT_REPORT: "project",
  CREATE_TASK: "createTask",
  TENANT_MANAGEMENT: "tenantManagement",
});

export const COMPANY_LOGIN_TENANTS = Object.freeze([
  "OLKA",
  "MCC",
  "SCH",
  "A101",
  "GRC",
  "MRDIY",
  "DEC",
  "CL",
  "HD",
]);

export const COMPANY_TENANT_SCOPES = Object.freeze({
  OLKA: Object.freeze(["SKC", "SKCP", "ASC", "BRR", "HFV", "HTR", "KLD"]),
  MCC: Object.freeze(["MCC"]),
  SCH: Object.freeze(["SCH"]),
  A101: Object.freeze(["A101"]),
  GRC: Object.freeze(["GRC"]),
  MRDIY: Object.freeze(["MRDIY"]),
  DEC: Object.freeze(["DEC"]),
  CL: Object.freeze(["CL"]),
  HD: Object.freeze(["HDV"]),
});

export const TENANT_PROJECT_SEED = Object.freeze({
  OLKA: Object.freeze(["OLK", "KLA", "ASCS", "SKCH"]),
  MCC: Object.freeze(["MC", "IMC"]),
  SCH: Object.freeze(["SOCH"]),
  A101: Object.freeze(["A101"]),
  GRC: Object.freeze(["GRAC"]),
  MRDIY: Object.freeze(["MDY"]),
  DEC: Object.freeze(["DEC"]),
  HD: Object.freeze(["KFC", "HDV"]),
});

const TASK_TENANT_ALIASES = Object.freeze({
  SKC: "OLKA",
  SKCP: "OLKA",
  ASC: "OLKA",
  BRR: "OLKA",
  HFV: "OLKA",
  HTR: "OLKA",
  KLD: "OLKA",
  HDV: "HD",
});

const TENANT_ADMIN_PAGES = Object.freeze([
  PAGES.RFR,
  PAGES.REJECT,
  PAGES.PROJECT_REPORT,
  PAGES.CREATE_TASK,
  PAGES.PROJECT_BOARD,
]);

const OLKA_PAGES = Object.freeze([
  PAGES.UNSPRINTED,
  PAGES.LABEL_SYNC,
  PAGES.OLKA_DEPLOY,
  PAGES.OLKA_SPRINT,
  PAGES.OLKA_ROADMAP,
]);

function normalizeCompanyTenant(tenant) {
  return String(tenant || "").trim().toUpperCase();
}

export function getAccessiblePages(actor) {
  const tenant = normalizeCompanyTenant(actor?.tenant);
  const isCommerceLab = tenant === GLOBAL_ACCESS_TENANT;
  const dailyPages = isCommerceLab ? [PAGES.DAILY, PAGES.CLOSED] : [];
  if (actor?.role === ROLES.OWNER_ADMIN) {
    return [
      ...dailyPages,
      ...TENANT_ADMIN_PAGES,
      ...(isCommerceLab
        ? [PAGES.OLKA_SPRINT, PAGES.TENANT_MANAGEMENT]
        : []),
      ...(tenant === "OLKA" ? OLKA_PAGES : []),
      ...(tenant === "HD" ? [PAGES.HDV_STATUS] : []),
    ];
  }
  if (actor?.role !== ROLES.TENANT_ADMIN) return [];
  return [
    ...dailyPages,
    ...TENANT_ADMIN_PAGES,
    ...(isCommerceLab ? [PAGES.OLKA_SPRINT] : []),
    ...(tenant === "OLKA" ? OLKA_PAGES : []),
    ...(tenant === "HD" ? [PAGES.HDV_STATUS] : []),
  ];
}

export function hasPageAccess(actor, page) {
  return getAccessiblePages(actor).includes(page);
}

export function getCompanyLoginTenant(tenant, availableTenants = []) {
  const scopes = COMPANY_TENANT_SCOPES[tenant] || [tenant];
  if (availableTenants.length === 0) return scopes[0];
  const available = new Set(availableTenants.map(normalizeCompanyTenant));
  const matchingScope = scopes.find((scope) => available.has(scope));
  if (matchingScope) return matchingScope;
  if (tenant === "HD") {
    return available.has("CL") ? "CL" : [...available][0] || null;
  }
  return null;
}

export function getCompanyTenantScopes(tenant) {
  return COMPANY_TENANT_SCOPES[tenant] || [];
}

export function getCompanyTenantOptions(availableTenants) {
  const available = new Set(availableTenants.map(normalizeCompanyTenant));
  return COMPANY_LOGIN_TENANTS.filter(
    (tenant) =>
      tenant === "HD" ||
      available.has(tenant) ||
      COMPANY_TENANT_SCOPES[tenant].some((scope) => available.has(scope)),
  );
}

export function getTenantProjectScope(tenant) {
  const normalizedTenant = normalizeCompanyTenant(tenant);
  return TASK_TENANT_ALIASES[normalizedTenant] || normalizedTenant;
}

export const CLAIMS = Object.freeze({
  role: "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
  name: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  id: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier",
  givenName:
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
  surname: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
});
