import { GLOBAL_ACCESS_TENANT, ROLES } from "./constants.js";

export function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  return (
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
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
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}
