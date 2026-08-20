export const ROLES = Object.freeze({
  OWNER_ADMIN: "OwnerAdmin",
  TENANT_ADMIN: "TenantAdmin",
  TENANT_USER: "TenantUser",
});

export const GLOBAL_ACCESS_TENANT = "CL";

export const COMPANY_LOGIN_TENANTS = Object.freeze([
  "MCC",
  "SCH",
  "A101",
  "GRC",
  "ASC",
  "KLD",
  "BRR",
  "SKCP",
  "EVY",
  "SKC",
  "MRDIY",
  "DEC",
  "LWR",
  "AK",
  "FA",
  "HFV",
  "CL",
  "HTR",
]);

export const CLAIMS = Object.freeze({
  role: "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
  name: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  id: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier",
  givenName:
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
  surname: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
});
