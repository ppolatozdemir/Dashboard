import { GLOBAL_ACCESS_TENANT, ROLES } from "./constants.js";
import { AuthError } from "./error.js";
import {
  hasGlobalTenantAccess,
  normalizeTenant,
  normalizeEmail,
  normalizeText,
  isValidEmail,
} from "./normalization.js";

const LOCAL_CREATABLE_ROLES = new Set([ROLES.TENANT_ADMIN]);

export function authorizeUserCreation(actor, input) {
  if (actor.role !== ROLES.OWNER_ADMIN && actor.role !== ROLES.TENANT_ADMIN) {
    throw new AuthError(403, "Kullanıcı oluşturma yetkiniz yok");
  }
  const candidate = normalizeUserInput(input);
  validateUserInput(candidate);
  validateTenantAssignment(actor, candidate);
  return candidate;
}

function normalizeUserInput(input) {
  const requestedTenants = Array.isArray(input.tenants)
    ? input.tenants.map(normalizeTenant).filter(Boolean)
    : [];
  return {
    email: normalizeEmail(input.email),
    displayName: normalizeText(input.displayName),
    role: normalizeText(input.role),
    password: input.password || "",
    tenants: [...new Set(requestedTenants)],
  };
}

function validateUserInput(user) {
  const { email, displayName, role, password, tenants } = user;
  if (
    !email ||
    !displayName ||
    !role ||
    !password ||
    tenants.length === 0
  ) {
    throw new AuthError(400, "Tüm kullanıcı alanları zorunludur");
  }
  if (!isValidEmail(email)) {
    throw new AuthError(400, "Geçerli bir e-posta adresi girilmelidir");
  }
  if (!LOCAL_CREATABLE_ROLES.has(role)) {
    throw new AuthError(400, "Geçersiz kullanıcı rolü");
  }
  if (tenants.includes(GLOBAL_ACCESS_TENANT)) {
    throw new AuthError(400, "Yerel kullanıcı CL tenantına atanamaz");
  }
  if (password.length < 10 || password.length > 200) {
    throw new AuthError(400, "Şifre 10-200 karakter arasında olmalıdır");
  }
}

function validateTenantAssignment(actor, user) {
  if (
    hasGlobalTenantAccess(actor) &&
    actor.source === "commercelab" &&
    !user.tenants.every((tenant) => actor.allowedTenants?.includes(tenant))
  ) {
    throw new AuthError(
      403,
      "Seçilen tenant CommerceLab oturumunuz için yetkili değil",
    );
  }
  if (
    !hasGlobalTenantAccess(actor) &&
    (user.tenants.length !== 1 ||
      normalizeTenant(actor.tenant) !== user.tenants[0])
  ) {
    throw new AuthError(
      403,
      "Kullanıcı yalnız aktif tenant için oluşturulabilir",
    );
  }
}
