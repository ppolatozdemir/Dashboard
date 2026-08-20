import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

// OLK roadmap labellarını keşfeder: hangi ay/roadmap etiketleri var,
// hangi statüler completed sayılmalı, tarih alanları (created/resolutiondate/duedate) neye benziyor.

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const OLKA_BASE_URL = (
  process.env.OLKA_BASE_URL || "https://olkaproduct.atlassian.net"
).replace(/\/$/, "");

const LOG = "explore-roadmap.log";
const lines = [];
function log(...a) {
  const s = a
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2)))
    .join(" ");
  lines.push(s);
  console.log(s);
}

function authHeader() {
  const { email, apiToken } = getConfig();
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

const TR_MONTHS = [
  "ocak",
  "şubat",
  "subat",
  "mart",
  "nisan",
  "mayıs",
  "mayis",
  "haziran",
  "temmuz",
  "ağustos",
  "agustos",
  "eylül",
  "eylul",
  "ekim",
  "kasım",
  "kasim",
  "aralık",
  "aralik",
];

function looksLikeRoadmap(label) {
  const l = label.toLowerCase();
  if (l.includes("roadmap")) return true;
  return TR_MONTHS.some((m) => l.includes(m));
}

// Enhanced JQL nextPageToken pagination
async function searchAllJql(baseUrl, jql, fields) {
  const headers = authHeader();
  const all = [];
  let nextPageToken = undefined;
  let page = 0;
  do {
    const body = { jql, fields, maxResults: 100 };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const res = await axios.post(`${baseUrl}/rest/api/3/search/jql`, body, {
      headers,
      timeout: 60000,
    });
    const issues = res.data.issues || [];
    all.push(...issues);
    nextPageToken = res.data.nextPageToken;
    page++;
    if (page > 80) break;
  } while (nextPageToken);
  return all;
}

async function explore(label, baseUrl, jql) {
  log(`\n=== ${label} ===`);
  log(`base: ${baseUrl}`);
  log(`jql: ${jql}`);
  let issues = [];
  try {
    issues = await searchAllJql(baseUrl, jql, [
      "summary",
      "labels",
      "status",
      "resolutiondate",
      "created",
      "duedate",
      "project",
      "issuetype",
    ]);
  } catch (e) {
    log(
      "ERROR:",
      e.response?.status,
      JSON.stringify(e.response?.data || e.message),
    );
    return;
  }
  log(`TOTAL ISSUES: ${issues.length}`);

  // Label frequency
  const labelCount = new Map();
  const roadmapLabelCount = new Map();
  const statusCount = new Map();
  const statusCategory = new Map();
  let withResolution = 0;
  let withDue = 0;

  for (const it of issues) {
    const f = it.fields || {};
    const labels = f.labels || [];
    for (const lb of labels) {
      labelCount.set(lb, (labelCount.get(lb) || 0) + 1);
      if (looksLikeRoadmap(lb)) {
        roadmapLabelCount.set(lb, (roadmapLabelCount.get(lb) || 0) + 1);
      }
    }
    const st = f.status?.name || "—";
    statusCount.set(st, (statusCount.get(st) || 0) + 1);
    const cat = f.status?.statusCategory?.key || "—";
    statusCategory.set(cat, (statusCategory.get(cat) || 0) + 1);
    if (f.resolutiondate) withResolution++;
    if (f.duedate) withDue++;
  }

  log(`\n-- ROADMAP-LIKE LABELS (${roadmapLabelCount.size}) --`);
  [...roadmapLabelCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => log(`  ${k}: ${v}`));

  log(`\n-- ALL LABELS (${labelCount.size}) top 60 --`);
  [...labelCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .forEach(([k, v]) => log(`  ${k}: ${v}`));

  log(`\n-- STATUSES (${statusCount.size}) --`);
  [...statusCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => log(`  ${k}: ${v}`));

  log(`\n-- STATUS CATEGORIES --`);
  [...statusCategory.entries()].forEach(([k, v]) => log(`  ${k}: ${v}`));

  log(`\nwith resolutiondate: ${withResolution}/${issues.length}`);
  log(`with duedate: ${withDue}/${issues.length}`);

  // Sample roadmap-labeled issues
  const roadmapIssues = issues.filter((it) =>
    (it.fields?.labels || []).some(looksLikeRoadmap),
  );
  log(`\n-- ISSUES WITH ROADMAP LABEL: ${roadmapIssues.length} --`);
  log(`-- 15 SAMPLES --`);
  roadmapIssues.slice(0, 15).forEach((it) => {
    const f = it.fields || {};
    const rl = (f.labels || []).filter(looksLikeRoadmap);
    log(
      `  ${it.key} [${f.status?.name}] (${f.status?.statusCategory?.key}) ` +
        `res=${f.resolutiondate ? f.resolutiondate.slice(0, 10) : "-"} ` +
        `due=${f.duedate || "-"} created=${f.created?.slice(0, 10)} ` +
        `roadmap=[${rl.join(",")}] :: ${(f.summary || "").slice(0, 60)}`,
    );
  });
}

async function main() {
  // Hebiar OLK project
  await explore(
    "HEBIAR OLK (project = OLK)",
    HEBIAR_BASE_URL,
    "project = OLK ORDER BY created DESC",
  );

  // Olka E-COMM DEVELOPMENT TEAM
  await explore(
    "OLKA E-COMM DEVELOPMENT TEAM",
    OLKA_BASE_URL,
    'project = "E-COMM DEVELOPMENT TEAM" ORDER BY created DESC',
  );

  log("\nDONE");
  fs.writeFileSync(LOG, lines.join("\n"), "utf8");
}

main().catch((e) => {
  log("FATAL:", e.message);
  fs.writeFileSync(LOG, lines.join("\n"), "utf8");
});
