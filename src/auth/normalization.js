import { GLOBAL_ACCESS_TENANT, ROLES } from "./constants.js";

export function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeUsername(value) {
  return normalizeText(value).toLocaleLowerCase("tr-TR");
}

export function normalizeTenant(value) {
  return normalizeText(value).toLocaleUpperCase("tr-TR");
}

export function hasGlobalTenantAccess(actor) {
  return normalizeTenant(actor?.tenant) === GLOBAL_ACCESS_TENANT;
}

export function resolveRole(value) {
  const candidates = Array.isArray(value) ? value : [value];
  return Object.values(ROLES).find((role) =>
    candidates.some(
      (candidate) =>
        normalizeText(candidate).toLocaleLowerCase("tr-TR") ===
        role.toLocaleLowerCase("tr-TR"),
    ),
  );
}

export function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}
