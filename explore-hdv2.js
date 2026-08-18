import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

const LOG_FILE = "explore-hdv2.log";
try { fs.writeFileSync(LOG_FILE, ""); } catch {}
function log(...args) {
  const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n";
  try { fs.appendFileSync(LOG_FILE, line, "utf8"); } catch {}
  process.stdout.write(line);
}

const HEBIAR_BASE_URL = (process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net").replace(/\/$/, "");
const PROJECT = process.env.HDV_PROJECT || "HDV";

function authHeader() {
  const { email, apiToken } = getConfig();
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
  const jql = `project = "${PROJECT}" AND statusCategory != Done ORDER BY issuetype, created DESC`;
  const issues = await searchAllJql(jql, ["summary", "status", "issuetype", "assignee", "reporter"]);
  log("Toplam açık:", issues.length);

  // Statü -> kategori eşlemesi
  const statusCat = {};
  for (const is of issues) {
    const s = is.fields.status;
    if (s) statusCat[s.name] = s.statusCategory?.name || "?";
  }
  log("\n--- Statü -> Kategori ---");
  Object.entries(statusCat).forEach(([k, v]) => log(`  ${k} => ${v}`));

  // Tüm Görev tipindeki tasklar (backend olabilecekler)
  log("\n--- TÜM 'Görev' tipi tasklar ---");
  issues.filter((is) => is.fields.issuetype?.name === "Görev").forEach((is) => {
    log(`  [${is.key}] (${is.fields.status?.name}) ${is.fields.summary}`);
  });

  // Web ve Kiosk tam liste
  log("\n--- TÜM 'Web' tipi tasklar ---");
  issues.filter((is) => is.fields.issuetype?.name === "Web").forEach((is) => {
    log(`  [${is.key}] (${is.fields.status?.name}) ${is.fields.summary}`);
  });
  log("\n--- TÜM 'Kiosk' tipi tasklar ---");
  issues.filter((is) => is.fields.issuetype?.name === "Kiosk").forEach((is) => {
    log(`  [${is.key}] (${is.fields.status?.name}) ${is.fields.summary}`);
  });

  log("\n=== BİTTİ ===");
}

main().catch((e) => log("FATAL:", e.stack || e.message));
