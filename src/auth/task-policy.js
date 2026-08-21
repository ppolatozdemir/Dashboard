import { canCreateTaskInProject, getTaskProjectKeys } from "./constants.js";
import { AuthError } from "./error.js";

export function taskProjectKeysFor(actor) {
  return getTaskProjectKeys(actor?.tenant);
}

export function authorizeTaskProject(actor, projectKey) {
  if (!canCreateTaskInProject(actor?.tenant, projectKey)) {
    throw new AuthError(
      403,
      "Seçilen proje aktif tenantınız için task oluşturmaya yetkili değil",
    );
  }
}
