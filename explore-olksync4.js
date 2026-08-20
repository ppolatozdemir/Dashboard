/**
 * OLK — bir önceki sprintten devreden VE hala açık (statusCategory != Done)
 * maddelerin kırılımı: kişi, statü, kaç sprinttir sürükleniyor.
 * Çıktı: explore-olksync4.log
 */
import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const PROJECT = process.env.OLK_PROJECT || "OLK";
const CURRENT = Number(process.env.OLK_CURRENT_SPRINT || 1414);
const PREV = Number(process.env.OLK_PREV_SPRINT || 1413);

const lines = [];
function log(...a) {
  const s = a
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2)))
    .join(" ");
  lines.push(s);
  console.log(s);
}

function client() {
  const { email, apiToken } = getConfig();
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return axios.create({
    baseURL: `${HEBIAR_BASE_URL}/rest/api/3`,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });
}

async function searchAll(api, jql, fields) {
  const out = [];
  let nextPageToken;
  do {
    const r = await api.post("/search/jql", {
      jql,
      fields,
      maxResults: 100,
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    out.push(...(r.data.issues || []));
    nextPageToken = r.data.nextPageToken;
  } while (nextPageToken && out.length < 500);
  return out;
}

function pad(s, n) {
  s = String(s ?? "");
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

async function main() {
  const api = client();

  const jql = `project = ${PROJECT} AND sprint = ${CURRENT} AND sprint = ${PREV} AND statusCategory != Done ORDER BY assignee ASC, key ASC`;
  const issues = await searchAll(api, jql, [
    "summary",
    "status",
    "assignee",
    "priority",
    "issuetype",
    "created",
    "updated",
    "duedate",
    "labels",
    "customfield_10020",
  ]);
  log(`JQL: ${jql}`);
  log(`Toplam: ${issues.length} madde\n`);

  const rows = issues.map((i) => {
    const sprints = i.fields.customfield_10020 || [];
    const weekly = sprints.filter((s) => /^weekly/i.test(s.name || ""));
    const first = weekly
      .map((s) => s.name)
      .sort()[0];
    return {
      key: i.key,
      summary: i.fields.summary,
      assignee: i.fields.assignee?.displayName || "Atanmamış",
      status: i.fields.status?.name,
      priority: i.fields.priority?.name || "-",
      type: i.fields.issuetype?.name || "-",
      sprintCount: weekly.length,
      firstSprint: first || "-",
      created: (i.fields.created || "").slice(0, 10),
      updated: (i.fields.updated || "").slice(0, 10),
      labels: (i.fields.labels || []).join(","),
    };
  });

  rows.sort(
    (a, b) =>
      b.sprintCount - a.sprintCount || a.assignee.localeCompare(b.assignee, "tr")
  );

  log("=== MADDE LİSTESİ (kaç sprinttir sürüklendiğine göre) ===");
  log(
    pad("TASK", 10) +
      pad("SPRINT#", 8) +
      pad("İLK SPRINT", 15) +
      pad("STATÜ", 24) +
      pad("ATANAN", 22) +
      "ÖZET"
  );
  for (const r of rows) {
    log(
      pad(r.key, 10) +
        pad(r.sprintCount, 8) +
        pad(r.firstSprint, 15) +
        pad(r.status, 24) +
        pad(r.assignee, 22) +
        (r.summary || "").slice(0, 70)
    );
  }

  const group = (fn) => {
    const m = new Map();
    for (const r of rows) m.set(fn(r), (m.get(fn(r)) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  log("\n=== STATÜ KIRILIMI ===");
  for (const [k, v] of group((r) => r.status)) log(`${pad(k, 26)} ${v}`);

  log("\n=== KİŞİ KIRILIMI ===");
  for (const [k, v] of group((r) => r.assignee)) log(`${pad(k, 26)} ${v}`);

  log("\n=== TİP KIRILIMI ===");
  for (const [k, v] of group((r) => r.type)) log(`${pad(k, 26)} ${v}`);

  log("\n=== ÖNCELİK KIRILIMI ===");
  for (const [k, v] of group((r) => r.priority)) log(`${pad(k, 26)} ${v}`);

  log("\n=== KAÇ SPRİNTTİR SÜRÜKLENİYOR ===");
  for (const [k, v] of group((r) => `${r.sprintCount} sprint`).sort(
    (a, b) => parseInt(b[0]) - parseInt(a[0])
  ))
    log(`${pad(k, 26)} ${v}`);

  log("DONE");
}

main()
  .catch((e) => {
    log("FATAL:", e.response?.status, JSON.stringify(e.response?.data || e.message));
    log("DONE");
  })
  .finally(() => fs.writeFileSync("explore-olksync4.log", lines.join("\n"), "utf8"));
