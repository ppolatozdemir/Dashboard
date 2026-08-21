import { CLAIMS, ROLES } from "./constants.js";
import { AuthError } from "./error.js";
import { normalizeTenant } from "./normalization.js";

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
  const tenant = normalizeTenant(payload.__tenant__);
  const displayName = [payload[CLAIMS.givenName], payload[CLAIMS.surname]]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    id: payload[CLAIMS.id] || payload.jti,
    email: payload[CLAIMS.name] || "",
    displayName: displayName || payload[CLAIMS.name] || "CommerceLab kullanıcısı",
    role: ROLES.OWNER_ADMIN,
    tenant: tenant || null,
    source: "commercelab",
    tenantScope: null,
    expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
  };
}
