import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

const LOG_FILE = "explore-hdv.log";
try { fs.writeFileSync(LOG_FILE, ""); } catch {}
function log(...args) {
  const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" ") + "\n";
  try { fs.appendFileSync(LOG_FILE, line, "utf8"); } catch {}
  process.stdout.write(line);
}

const HEBIAR_BASE_URL = (process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net").replace(/\/$/, "");
const PROJECT = process.env.HDV_PROJECT || "HDV";

function authHeader() {
  const { email, apiToken } = getConfig();
  if (!email || !apiToken) throw new Error("Jira kimlik bilgileri eksik.");
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" };
}

async function searchAllJql(jql, fields) {
  const headers = authHeader();
  let nextPageToken = null, pages = 0;
  const all = [];
  do {
    const params = { jql, fields: fields.join(","), maxResults: 100 };
    if (nextPageToken) params.nextPageToken = nextPageToken;
    const res = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/search/jql`, { params, headers, timeout: 30000 });
    all.push(...(res.data.issues || []));
    nextPageToken = res.data.isLast ? null : res.data.nextPageToken || null;
    pages++;
  } while (nextPageToken && pages < 50);
  return all;
}

async function main() {
  log("=== HDV proje keşfi ===");
  log("Base URL:", HEBIAR_BASE_URL, "Project:", PROJECT);

  // 1) Proje bilgisi + component listesi
  try {
    const proj = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/project/${PROJECT}`, { headers: authHeader(), timeout: 30000 });
    log("\n--- Proje ---");
    log("Ad:", proj.data.name, "Key:", proj.data.key, "Id:", proj.data.id);
    log("Issue Types:", (proj.data.issueTypes || []).map((t) => t.name).join(", "));
    log("Components:", (proj.data.components || []).map((c) => c.name).join(", ") || "(yok)");
  } catch (e) {
    log("Proje bilgisi hatası:", e.response?.status, JSON.stringify(e.response?.data?.errorMessages || e.message));
  }

  // 2) Tüm açık tasklar (statusCategory != Done)
  const jql = `project = "${PROJECT}" AND statusCategory != Done ORDER BY created DESC`;
  let issues = [];
  try {
    issues = await searchAllJql(jql, ["summary", "status", "assignee", "reporter", "issuetype", "components", "labels", "parent"]);
  } catch (e) {
    log("Arama hatası:", e.response?.status, JSON.stringify(e.response?.data?.errorMessages || e.message));
    // fallback: resolution EMPTY
    try {
      issues = await searchAllJql(`project = "${PROJECT}" AND resolution = EMPTY ORDER BY created DESC`, ["summary", "status", "assignee", "reporter", "issuetype", "components", "labels", "parent"]);
    } catch (e2) {
      log("Fallback arama hatası:", e2.response?.status, JSON.stringify(e2.response?.data?.errorMessages || e2.message));
    }
  }

  log("\n--- Açık task sayısı:", issues.length, "---");

  const byType = {}, byStatus = {}, byComponent = {}, byLabel = {};
  for (const is of issues) {
    const f = is.fields || {};
    const t = f.issuetype?.name || "(yok)";
    const s = f.status?.name || "(yok)";
    byType[t] = (byType[t] || 0) + 1;
    byStatus[s] = (byStatus[s] || 0) + 1;
    for (const c of f.components || []) byComponent[c.name] = (byComponent[c.name] || 0) + 1;
    for (const l of f.labels || []) byLabel[l] = (byLabel[l] || 0) + 1;
  }

  log("\n--- Issue Type dağılımı ---");
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => log(`  ${k}: ${v}`));
  log("\n--- Statü dağılımı ---");
  Object.entries(byStatus).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => log(`  ${k}: ${v}`));
  log("\n--- Component dağılımı ---");
  const comps = Object.entries(byComponent).sort((a, b) => b[1] - a[1]);
  if (comps.length === 0) log("  (component kullanılmıyor)");
  comps.forEach(([k, v]) => log(`  ${k}: ${v}`));
  log("\n--- Label dağılımı ---");
  const labels = Object.entries(byLabel).sort((a, b) => b[1] - a[1]);
  if (labels.length === 0) log("  (label kullanılmıyor)");
  labels.forEach(([k, v]) => log(`  ${k}: ${v}`));

  log("\n--- İlk 60 task özeti (kategorizasyon ipucu için) ---");
  issues.slice(0, 60).forEach((is) => {
    const f = is.fields || {};
    log(`  [${is.key}] (${f.issuetype?.name}) {${(f.components||[]).map(c=>c.name).join('/')||'-'}} <${(f.labels||[]).join(',')||'-'}> ${f.summary}`);
  });

  log("\n=== BİTTİ ===");
}

main().catch((e) => log("FATAL:", e.stack || e.message));
