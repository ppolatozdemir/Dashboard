import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

/**
 * HDV (HDHOLDING) projesine EKLENEN KULLANICILAR + EKLENME TARİHİ.
 *
 * Kaynak: Jira audit log (/rest/api/3/auditing/record). "Project roles changed"
 * kayıtlarındaki Member/Üye rolü "Users" alanının changedFrom -> changedTo farkı
 * alınarak her accountId'nin İLK eklendiği an bulunur. Rol aktörleri (mevcut üyeler)
 * ile birleştirilerek isim çözümlenir; audit penceresinden (retention) önce eklenen
 * üyeler ayrıca işaretlenir.
 *
 * Çıktı: hdv-added-users.log (UTF-8) + konsol.
 * Ortam değişkenleri: HEBIAR_BASE_URL, HDV_PROJECT
 */

const LOG_FILE = "hdv-added-users.log";
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
const MEMBER_ROLE_NAMES = new Set(["Member", "Üye"]);

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

function parseIds(str) {
  if (!str) return [];
  return str
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function fmtDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function mapWithConcurrency(items, limit, fn) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

async function main() {
  log("=== HDV (HDHOLDING) projesine eklenen kullanıcılar + tarih ===\n");

  // 1) Mevcut üyeler (rol aktörleri) -> accountId -> {name, roles}
  const nameById = new Map();
  const currentMemberIds = new Set();
  let projName = "HDHOLDING";
  try {
    const proj = await axios.get(
      `${HEBIAR_BASE_URL}/rest/api/3/project/${PROJECT}`,
      { headers: authHeader(), timeout: 30000 },
    );
    projName = proj.data.name;
  } catch {}
  try {
    const rolesRes = await axios.get(
      `${HEBIAR_BASE_URL}/rest/api/3/project/${PROJECT}/role`,
      { headers: authHeader(), timeout: 30000 },
    );
    for (const [roleName, roleUrl] of Object.entries(rolesRes.data || {})) {
      try {
        const rd = await axios.get(roleUrl, {
          headers: authHeader(),
          timeout: 30000,
        });
        for (const a of rd.data.actors || []) {
          if (a.type === "atlassian-user-role-actor" || a.actorUser) {
            const id = a.actorUser?.accountId || a.id;
            nameById.set(id, a.displayName);
            if (MEMBER_ROLE_NAMES.has(roleName) || roleName === "Administrator")
              currentMemberIds.add(id);
          }
        }
      } catch {}
    }
  } catch (e) {
    log("Rol listesi hatası:", e.response?.status, e.message);
  }

  // 2) TÜM audit kayıtları (filtre YOK — filtre metni ara kayıtları kaçırıyor)
  const records = [];
  try {
    let offset = 0;
    const limit = 1000;
    for (let page = 0; page < 25; page++) {
      const res = await axios.get(
        `${HEBIAR_BASE_URL}/rest/api/3/auditing/record`,
        {
          params: { offset, limit },
          headers: authHeader(),
          timeout: 60000,
        },
      );
      const recs = res.data.records || [];
      records.push(...recs);
      const total = res.data.total ?? recs.length;
      offset += limit;
      if (offset >= total || recs.length === 0) break;
    }
  } catch (e) {
    log(
      "Audit erişim hatası:",
      e.response?.status,
      JSON.stringify(e.response?.data?.errorMessages || e.message),
    );
    log("(Administer Jira izni gerekir; tarih alınamıyor.)");
    return;
  }

  // Proje eşleşmesi: associatedItems veya objectItem, ad VEYA id (10457) ile
  const projMatches = (r) => {
    const items = [r.objectItem, ...(r.associatedItems || [])].filter(Boolean);
    return items.some(
      (it) =>
        it.typeName === "PROJECT" &&
        (it.name === projName ||
          it.id === "10457" ||
          it.id === String(PROJECT)),
    );
  };

  // 3) Member/Üye rol değişimlerini kronolojik sırala, ekleme olaylarını çıkar
  const roleChanges = records
    .filter(
      (r) =>
        r.summary === "Project roles changed" &&
        r.objectItem?.typeName === "PROJECT_ROLE" &&
        MEMBER_ROLE_NAMES.has(r.objectItem?.name) &&
        projMatches(r),
    )
    .sort((a, b) => new Date(a.created) - new Date(b.created));

  // Her accountId'nin İLK göründüğü kaydı bul (roleChanges kronolojik).
  // inFrom=true  -> o kayıttan ÖNCE zaten üyeydi (kesin tarih yok, ≤ o tarih)
  // inFrom=false -> o kayıtta yeni eklendi (kesin ekleme tarihi = o tarih)
  const firstSeen = new Map(); // accountId -> { iso, inFrom }
  for (const r of roleChanges) {
    const uc = (r.changedValues || []).find((c) => c.fieldName === "Users");
    if (!uc) continue;
    const fromSet = new Set(parseIds(uc.changedFrom));
    for (const id of new Set([...fromSet, ...parseIds(uc.changedTo)])) {
      if (!firstSeen.has(id))
        firstSeen.set(id, { iso: r.created, inFrom: fromSet.has(id) });
    }
  }

  // 4) Bilinmeyen accountId'leri kullanıcı API'siyle çöz
  const allIds = new Set([...firstSeen.keys(), ...currentMemberIds]);
  const unknown = [...allIds].filter(
    (id) =>
      !nameById.has(id) && /^[0-9a-fA-F]/.test(id) && !id.startsWith("ug:"),
  );
  await mapWithConcurrency(unknown, 5, async (id) => {
    try {
      const res = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/user`, {
        params: { accountId: id },
        headers: authHeader(),
        timeout: 20000,
      });
      nameById.set(
        id,
        res.data.displayName + (res.data.active === false ? " (pasif)" : ""),
      );
    } catch {
      nameById.set(id, "(bilinmeyen kullanıcı)");
    }
  });

  const nm = (id) => nameById.get(id) || id;

  // 5) Sonuç: kesin eklenenler (inFrom=false) ve öncesinde var olanlar (inFrom=true)
  const rows = [...firstSeen.entries()]
    .map(([id, v]) => ({
      id,
      iso: v.iso,
      exact: !v.inFrom,
      name: nm(id),
      current: currentMemberIds.has(id),
    }))
    .sort((a, b) => new Date(a.iso) - new Date(b.iso));
  const exactRows = rows.filter((r) => r.exact);
  const preRows = rows.filter((r) => !r.exact);

  log(`Proje: ${projName} (${PROJECT})   Base: ${HEBIAR_BASE_URL}`);
  log(
    `Audit kaydı: ${records.length} | Member/Üye rol değişim olayı: ${roleChanges.length}`,
  );
  log(
    `Audit penceresi: ${roleChanges.length ? fmtDate(roleChanges[0].created) : "-"}  →  ${roleChanges.length ? fmtDate(roleChanges[roleChanges.length - 1].created) : "-"}\n`,
  );

  log("=== EKLENME TARİHİ KESİN OLAN KULLANICILAR (audit, kronolojik) ===");
  log("Ekleme Tarihi      | Durum   | Kullanıcı");
  log("-------------------|---------|------------------------------");
  for (const r of exactRows) {
    log(
      `${fmtDate(r.iso).padEnd(18)} | ${(r.current ? "üye" : "AYRILDI").padEnd(7)} | ${r.name}`,
    );
  }

  log(
    `\n=== AUDIT PENCERESİNDEN ÖNCE EKLENENLER (kesin tarih yok; en geç ≤ tarih) ===`,
  );
  if (!preRows.length) log("  (yok)");
  for (const r of preRows) {
    log(
      `≤ ${fmtDate(r.iso).padEnd(16)} | ${(r.current ? "üye" : "AYRILDI").padEnd(7)} | ${r.name}`,
    );
  }

  // Şu an üye AMA hiç Member/Üye rol-değişim kaydında görünmeyenler (ör. proje lideri/Administrator)
  const missing = [...currentMemberIds].filter((id) => !firstSeen.has(id));
  if (missing.length) {
    log(
      "\n=== Şu an üye AMA Member rol kaydı yok (proje lideri/Administrator; kuruluşta eklenmiş) ===",
    );
    for (const id of missing) log(`  ${nm(id)}`);
  }

  log("\n=== ÖZET ===");
  log(
    `Toplam mevcut insan üye (Member+Administrator): ${currentMemberIds.size}`,
  );
  log(`Ekleme tarihi kesin bulunan: ${exactRows.length}`);
  log(`Audit öncesi (tarih ≤): ${preRows.length}`);
  log("\n=== BİTTİ (DONE) ===");
}

main().catch((e) => log("FATAL:", e.stack || e.message));
