import { CLAIMS, ROLES } from "./constants.js";
import { AuthError } from "./error.js";
import {
  normalizeTenant,
  resolveRole,
} from "./normalization.js";

function decodeJwtPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("JWT biçimi geçersiz");
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new AuthError(401, "Geçersiz oturum token'ı");
  }
}

export function identityFromCompanyToken(token) {
  const payload = decodeJwtPayload(token);
  const role = resolveRole(payload[CLAIMS.role]);
  if (!role) {
    throw new AuthError(403, "Bu uygulama için geçerli bir rol bulunamadı");
  }

  const tenant = normalizeTenant(payload.__tenant__);
  if (role !== ROLES.OWNER_ADMIN && !tenant) {
    throw new AuthError(403, "Token içinde tenant bilgisi bulunamadı");
  }
  const displayName = [payload[CLAIMS.givenName], payload[CLAIMS.surname]]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    id: payload[CLAIMS.id] || payload.jti,
    username: payload[CLAIMS.name] || "",
    displayName: displayName || payload[CLAIMS.name] || "CommerceLab kullanıcısı",
    role,
    tenant: tenant || null,
    source: "commercelab",
    tenantScope: role === ROLES.OWNER_ADMIN ? null : tenant,
    expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
  };
}
