import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

/**
 * HDV projesine EKLENEN KULLANICILARI ekleme tarihiyle keşfetmek için tarama.
 * - Proje bilgisi (ad/id)
 * - Proje rolleri + rollerdeki mevcut aktörler (kullanıcılar) = "kimler" (anlık üyelik)
 * - Audit log (/rest/api/3/auditing/record) = "ne zaman eklendi" (tarih kaynağı)
 *
 * Not: Jira Cloud, "kullanıcı projeye ne zaman eklendi" bilgisini yalnızca audit
 * kayıtlarında tutar (Administer Jira izni gerekir; ücretsiz planlarda saklama süresi kısıtlı olabilir).
 */

const LOG_FILE = "explore-hdv-users.log";
try {
  fs.writeFileSync(LOG_FILE, "");
} catch {}
function log(...args) {
  const line =
    args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2)))
      .join(" ") + "\n";
  try {
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch {}
  process.stdout.write(line);
}

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const PROJECT = process.env.HDV_PROJECT || "HDV";

function authHeader() {
  const { email, apiToken } = getConfig();
  if (!email || !apiToken) throw new Error("Jira kimlik bilgileri eksik.");
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function main() {
  log("=== HDV kullanıcı/ekleme-tarihi keşfi ===");
  log("Base URL:", HEBIAR_BASE_URL, "Project:", PROJECT);

  // 1) Proje bilgisi
  let projName = PROJECT,
    projId = null;
  try {
    const proj = await axios.get(
      `${HEBIAR_BASE_URL}/rest/api/3/project/${PROJECT}`,
      { headers: authHeader(), timeout: 30000 },
    );
    projName = proj.data.name;
    projId = proj.data.id;
    log("\n--- Proje ---");
    log(
      "Ad:",
      projName,
      "Key:",
      proj.data.key,
      "Id:",
      projId,
      "Style:",
      proj.data.style || "?",
    );
    log("Lead:", proj.data.lead?.displayName || "?");
  } catch (e) {
    log(
      "Proje bilgisi hatası:",
      e.response?.status,
      JSON.stringify(e.response?.data?.errorMessages || e.message),
    );
  }

  // 2) Proje rolleri + aktörler (mevcut üyeler)
  const currentUsers = new Map(); // accountId -> {displayName, roles:Set}
  try {
    const rolesRes = await axios.get(
      `${HEBIAR_BASE_URL}/rest/api/3/project/${PROJECT}/role`,
      { headers: authHeader(), timeout: 30000 },
    );
    const roleMap = rolesRes.data || {};
    log("\n--- Proje rolleri ---");
    log("Roller:", Object.keys(roleMap).join(", ") || "(yok)");
    for (const [roleName, roleUrl] of Object.entries(roleMap)) {
      try {
        const rd = await axios.get(roleUrl, {
          headers: authHeader(),
          timeout: 30000,
        });
        const actors = rd.data.actors || [];
        for (const a of actors) {
          const type = a.type; // atlassian-user-role-actor | atlassian-group-role-actor
          if (type === "atlassian-user-role-actor" || a.actorUser) {
            const accId = a.actorUser?.accountId || a.id;
            if (!currentUsers.has(accId))
              currentUsers.set(accId, {
                displayName: a.displayName,
                roles: new Set(),
              });
            currentUsers.get(accId).roles.add(roleName);
          }
        }
        log(
          `  [${roleName}] aktör sayısı: ${actors.length} — kullanıcılar: ${
            actors
              .filter(
                (a) => a.type === "atlassian-user-role-actor" || a.actorUser,
              )
              .map((a) => a.displayName)
              .join(", ") || "(yok)"
          }${
            actors.some((a) => a.type === "atlassian-group-role-actor")
              ? " | GRUPLAR: " +
                actors
                  .filter((a) => a.type === "atlassian-group-role-actor")
                  .map((a) => a.displayName)
                  .join(", ")
              : ""
          }`,
        );
      } catch (e) {
        log(
          `  [${roleName}] rol detay hatası:`,
          e.response?.status,
          JSON.stringify(e.response?.data?.errorMessages || e.message),
        );
      }
    }
    log(
      "\n--- Mevcut kullanıcı üyeler (rol aktörü, benzersiz):",
      currentUsers.size,
      "---",
    );
    for (const [accId, u] of currentUsers)
      log(`  ${u.displayName}  <${accId}>  roller: ${[...u.roles].join(", ")}`);
  } catch (e) {
    log(
      "Rol listesi hatası:",
      e.response?.status,
      JSON.stringify(e.response?.data?.errorMessages || e.message),
    );
  }

  // 3) Audit log — ekleme tarihleri
  log("\n--- Audit log taraması (filter =", JSON.stringify(projName), ") ---");
  const auditRecords = [];
  try {
    let offset = 0;
    const limit = 1000;
    for (let page = 0; page < 10; page++) {
      const res = await axios.get(
        `${HEBIAR_BASE_URL}/rest/api/3/auditing/record`,
        {
          params: { filter: projName, offset, limit },
          headers: authHeader(),
          timeout: 45000,
        },
      );
      const recs = res.data.records || [];
      auditRecords.push(...recs);
      const total = res.data.total ?? recs.length;
      log(
        `  sayfa ${page}: ${recs.length} kayıt (offset ${offset}, toplam bildirilen ${total})`,
      );
      offset += limit;
      if (offset >= total || recs.length === 0) break;
    }
  } catch (e) {
    log(
      "  Audit erişim hatası:",
      e.response?.status,
      JSON.stringify(
        e.response?.data?.errorMessages || e.response?.data || e.message,
      ),
    );
    log(
      "  (403/permission ise: Administer Jira izni gerekir — audit ile tarih alınamaz.)",
    );
  }

  log("\n  Toplam çekilen audit kaydı:", auditRecords.length);
  if (auditRecords.length) {
    // Distinct summary'ler
    const summaries = {};
    for (const r of auditRecords)
      summaries[r.summary] = (summaries[r.summary] || 0) + 1;
    log("\n  --- Audit summary dağılımı ---");
    Object.entries(summaries)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => log(`    ${k}: ${v}`));

    // "added" / "role" / "user" içeren kayıtları detaylı bas
    const relevant = auditRecords.filter((r) =>
      /add|role|user|member|access|grant/i.test(r.summary || ""),
    );
    log(
      "\n  --- İlgili görünen kayıtlar (add/role/user/member/access):",
      relevant.length,
      "---",
    );
    relevant.slice(0, 80).forEach((r) => {
      const obj = r.objectItem
        ? `${r.objectItem.typeName}:${r.objectItem.name}`
        : "-";
      const assoc = (r.associatedItems || [])
        .map((a) => `${a.typeName}:${a.name}`)
        .join(" | ");
      const changed = (r.changedValues || [])
        .map(
          (c) => `${c.fieldName}:${c.changedFrom || ""}→${c.changedTo || ""}`,
        )
        .join(" ; ");
      log(
        `    [${r.created}] "${r.summary}" | obj=${obj} | assoc=[${assoc}] | changed=[${changed}]`,
      );
    });

    // Ham örnek (yapıyı görmek için ilk ilgili kayıt)
    if (relevant.length) {
      log("\n  --- Ham örnek kayıt (yapı) ---");
      log(JSON.stringify(relevant[0], null, 2));
    }
  }

  log("\n=== BİTTİ (DONE) ===");
}

main().catch((e) => log("FATAL:", e.stack || e.message));
