import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

const LOG_FILE = "copy-hdv216-comment-to-hdv450.log";
try { fs.writeFileSync(LOG_FILE, ""); } catch {}
function log(...args) {
  const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" ") + "\n";
  try { fs.appendFileSync(LOG_FILE, line, "utf8"); } catch {}
  process.stdout.write(line);
}

const HEBIAR_BASE_URL = (process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net").replace(/\/$/, "");
const SOURCE_ISSUE = "HDV-216";
const SOURCE_COMMENT = "61616"; // Amir Daliri, 2026-08-10T21:52:02.260+0300
const TARGET_ISSUE = "HDV-450";
const DRY_RUN = process.argv.includes("--dry-run");

function authHeader() {
  const { email, apiToken } = getConfig();
  if (!email || !apiToken) throw new Error("Jira kimlik bilgileri eksik.");
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" };
}

async function main() {
  const headers = authHeader();

  // 1) Kaynak yorumu al (tam ADF)
  const cRes = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/issue/${SOURCE_ISSUE}/comment/${SOURCE_COMMENT}`, { headers, timeout: 30000 });
  const commentBody = cRes.data.body;
  const author = cRes.data.author?.displayName;
  const created = cRes.data.created;
  log(`Kaynak yorum: ${SOURCE_ISSUE} #${SOURCE_COMMENT} | ${author} | ${created}`);
  if (!commentBody || commentBody.type !== "doc" || !Array.isArray(commentBody.content)) {
    throw new Error("Yorum gövdesi beklenen ADF doc formatında değil.");
  }

  // 2) Hedef maddenin mevcut açıklamasını al
  const iRes = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/issue/${TARGET_ISSUE}`, { params: { fields: "summary,description" }, headers, timeout: 30000 });
  const existing = iRes.data.fields?.description;
  log(`Hedef: ${TARGET_ISSUE} | ${iRes.data.fields?.summary}`);
  const hasExisting = existing && Array.isArray(existing.content) && existing.content.length > 0;
  log("Mevcut açıklama var mı?", hasExisting ? "EVET (yorum sonuna eklenecek)" : "HAYIR (boş, yorum yazılacak)");

  // 3) Yeni açıklama ADF'sini oluştur — mevcut varsa koru + ayraç + yorum içeriği
  let newContent;
  if (hasExisting) {
    newContent = [...existing.content, { type: "rule" }, ...commentBody.content];
  } else {
    newContent = [...commentBody.content];
  }
  const newDescription = { type: "doc", version: 1, content: newContent };

  if (DRY_RUN) {
    log("\n[DRY-RUN] Yazılacak açıklama ADF:");
    log(JSON.stringify(newDescription, null, 2));
    log("\nDONE");
    return;
  }

  // 4) Güncelle
  await axios.put(`${HEBIAR_BASE_URL}/rest/api/3/issue/${TARGET_ISSUE}`, { fields: { description: newDescription } }, { headers, timeout: 30000 });
  log("PUT tamam. Doğrulanıyor...");

  // 5) Doğrula
  const vRes = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/issue/${TARGET_ISSUE}`, { params: { fields: "description" }, headers, timeout: 30000 });
  const savedLen = JSON.stringify(vRes.data.fields?.description || {}).length;
  log("Kaydedilen açıklama uzunluğu (JSON):", savedLen, "byte");
  log("Kaydedilen içerik node sayısı:", (vRes.data.fields?.description?.content || []).length);
  log(`\nBağlantı: ${HEBIAR_BASE_URL}/browse/${TARGET_ISSUE}`);
  log("DONE");
}

main().catch((e) => {
  log("HATA:", e.response?.status, JSON.stringify(e.response?.data || e.message));
  log("DONE");
});
