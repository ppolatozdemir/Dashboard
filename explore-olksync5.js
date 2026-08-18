/**
 * İki JQL sorgusunun küme farkını çıkarır (1'de olup 2'de olmayan ve tersi).
 * Çıktı: explore-olksync5.log
 */
import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");

const JQL1 =
  'project = OLK AND sprint in openSprints() AND sprint not in closedSprints() and status != Deleted';
const JQL2 =
  'project = OLK AND status != Deleted and status IN ("Ready For Release","Ready For Reliase","QA TESTING",ONLIVE,Onlive,Done,"Tamamlandı",test,MERGED,MERGE) AND duedate > -7d';

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

const FIELDS = [
  "summary",
  "status",
  "assignee",
  "duedate",
  "resolutiondate",
  "customfield_10020",
];

async function searchAll(api, jql) {
  const out = [];
  let nextPageToken;
  do {
    const r = await api.post("/search/jql", {
      jql,
      fields: FIELDS,
      maxResults: 100,
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    out.push(...(r.data.issues || []));
    nextPageToken = r.data.nextPageToken;
  } while (nextPageToken && out.length < 1000);
  return out;
}

function pad(s, n) {
  s = String(s ?? "");
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function line(i) {
  const f = i.fields;
  const sprints = (f.customfield_10020 || [])
    .filter((s) => s.state === "active")
    .map((s) => s.name)
    .join(",");
  return (
    pad(i.key, 10) +
    pad(f.status?.name, 22) +
    pad(f.duedate || "duedate YOK", 14) +
    pad(f.assignee?.displayName || "Atanmamış", 20) +
    pad(sprints || "-", 15) +
    (f.summary || "").slice(0, 60)
  );
}

async function main() {
  const api = client();

  const a = await searchAll(api, JQL1);
  const b = await searchAll(api, JQL2);

  log(`1. sorgu: ${a.length} madde\n   ${JQL1}\n`);
  log(`2. sorgu: ${b.length} madde\n   ${JQL2}\n`);

  const bKeys = new Set(b.map((i) => i.key));
  const aKeys = new Set(a.map((i) => i.key));

  const onlyA = a.filter((i) => !bKeys.has(i.key));
  const onlyB = b.filter((i) => !aKeys.has(i.key));
  const both = a.filter((i) => bKeys.has(i.key));

  const header =
    pad("TASK", 10) +
    pad("STATÜ", 22) +
    pad("DUE DATE", 14) +
    pad("ATANAN", 20) +
    pad("AKTİF SPRINT", 15) +
    "ÖZET";

  log(`=== 1'DE OLUP 2'DE OLMAYAN: ${onlyA.length} madde ===`);
  log(header);
  for (const i of onlyA.sort((x, y) => x.key.localeCompare(y.key))) log(line(i));

  log(`\n=== 2'DE OLUP 1'DE OLMAYAN: ${onlyB.length} madde ===`);
  log(header);
  for (const i of onlyB.sort((x, y) => x.key.localeCompare(y.key))) log(line(i));

  log(`\n=== HER İKİSİNDE DE: ${both.length} madde ===`);
  log(both.map((i) => i.key).join(", "));

  // 1'de olup 2'de olmayanların NEDEN düştüğünü sınıflandır
  const STATUSES = new Set(
    [
      "ready for release",
      "ready for reliase",
      "qa testing",
      "onlive",
      "done",
      "tamamlandı",
      "test",
      "merged",
      "merge",
    ]
  );
  log(`\n=== 1'DE OLUP 2'DE OLMAYANLARIN SEBEBİ ===`);
  const reasons = new Map();
  for (const i of onlyA) {
    const st = (i.fields.status?.name || "").toLowerCase();
    const statusOk = STATUSES.has(st);
    const due = i.fields.duedate;
    const dueOk =
      due && new Date(due).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000;
    let reason;
    if (!statusOk && !dueOk)
      reason = "statü listede DEĞİL + duedate uygun değil/yok";
    else if (!statusOk) reason = "statü listede DEĞİL";
    else reason = due ? "duedate 7 günden eski" : "duedate BOŞ";
    reasons.set(reason, [...(reasons.get(reason) || []), i.key]);
    log(
      `${pad(i.key, 10)} ${pad(i.fields.status?.name, 22)} ${pad(
        i.fields.duedate || "YOK",
        12
      )} -> ${reason}`
    );
  }
  log("\n--- özet ---");
  for (const [r, keys] of reasons) log(`${pad(r, 45)} ${keys.length}  (${keys.join(", ")})`);

  log("DONE");
}

main()
  .catch((e) => {
    log("FATAL:", e.response?.status, JSON.stringify(e.response?.data || e.message));
    log("DONE");
  })
  .finally(() => fs.writeFileSync("explore-olksync5.log", lines.join("\n"), "utf8"));
