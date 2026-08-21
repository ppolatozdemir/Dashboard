import authService from "./service.js";
import { AuthError } from "./error.js";

export function taskProjectKeysFor(actor, repository = authService.repository) {
  return repository.getTenantProjectKeys(actor?.tenant);
}

export function authorizeTaskProject(
  actor,
  projectKey,
  repository = authService.repository,
) {
  const normalizedProjectKey = String(projectKey || "").trim().toUpperCase();
  if (!taskProjectKeysFor(actor, repository).includes(normalizedProjectKey)) {
    throw new AuthError(
      403,
      "Seçilen proje aktif tenantınız için task oluşturmaya yetkili değil",
    );
  }
}
