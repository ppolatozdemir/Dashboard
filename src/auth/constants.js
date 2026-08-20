export const ROLES = Object.freeze({
  OWNER_ADMIN: "OwnerAdmin",
  TENANT_ADMIN: "TenantAdmin",
});

export const GLOBAL_ACCESS_TENANT = "CL";

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

function normalizeCompanyTenant(tenant) {
  return String(tenant || "").trim().toUpperCase();
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

export const CLAIMS = Object.freeze({
  role: "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
  name: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  id: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier",
  givenName:
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
  surname: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
});
