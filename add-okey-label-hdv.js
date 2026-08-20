import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

/**
 * HDV — "Okey" etiketi ekleme
 *
 * Hebiar weekly board 54'teki AKTİF sprint + "weekly260817" sprintindeki,
 * belirtilen kişilere atanmış TÜM HDV maddelerine `Okey` etiketini ekler.
 * Mevcut etiketler korunur (sadece ekleme yapılır).
 *
 * Kullanım:
 *   node add-okey-label-hdv.js --dry-run   # sadece önizleme
 *   node add-okey-label-hdv.js             # gerçek yazma
 */

const LOG_FILE = process.env.OKEY_LOG_FILE || "add-okey-label-hdv.log";
try {
  fs.writeFileSync(LOG_FILE, "");
} catch {}
const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
function _tee(args) {
  const line =
    args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") +
    "\n";
  try {
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch {}
}
console.log = (...a) => {
  _tee(a);
  _origLog(...a);
};
console.error = (...a) => {
  _tee(a);
  _origErr(...a);
};

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const WEEKLY_BOARD_ID = Number(process.env.HEBIAR_WEEKLY_BOARD_ID || 54);
const PROJECT_KEY = process.env.OKEY_PROJECT || "HDV";
const LABEL = process.env.OKEY_LABEL || "Okey";
const NEXT_SPRINT_NAME = process.env.OKEY_NEXT_SPRINT || "weekly260817";
const REQ_TIMEOUT = Number(process.env.OKEY_TIMEOUT_MS || 30000);
const CONCURRENCY = Number(process.env.OKEY_CONCURRENCY || 5);
const DRY_RUN =
  process.env.DRY_RUN === "1" || process.argv.includes("--dry-run");

const TARGET_PEOPLE = ["Mehmet Ali", "Alper Özçelik", "Amir Daliri", "Gökhan Koçak"];

function authHeader() {
  const { email, apiToken } = getConfig();
  if (!email || !apiToken) {
    throw new Error(
      'Jira kimlik bilgileri eksik. Önce "jira config" komutunu çalıştırın.',
    );
  }
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

const api = axios.create({
  baseURL: HEBIAR_BASE_URL,
  timeout: REQ_TIMEOUT,
});

function normalize(s) {
  return String(s || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, " ")
    .trim();
}

const TARGET_NORM = TARGET_PEOPLE.map(normalize);

function matchPerson(displayName) {
  const n = normalize(displayName);
  if (!n) return null;
  const idx = TARGET_NORM.findIndex((t) => n === t || n.startsWith(t + " ") || n.includes(t));
  return idx >= 0 ? TARGET_PEOPLE[idx] : null;
}

async function fetchSprints() {
  const headers = authHeader();
  const all = [];
  let startAt = 0;
  for (let i = 0; i < 50; i++) {
    const { data } = await api.get(
      `/rest/agile/1.0/board/${WEEKLY_BOARD_ID}/sprint`,
      { headers, params: { state: "active,future", startAt, maxResults: 50 } },
    );
    all.push(...(data.values || []));
    if (data.isLast || !data.values?.length) break;
    startAt += data.values.length;
  }
  return all.filter((s) => s.originBoardId === WEEKLY_BOARD_ID);
}

async function searchAllJql(jql, fields) {
  const headers = authHeader();
  const all = [];
  let nextPageToken;
  for (let i = 0; i < 50; i++) {
    const body = { jql, fields, maxResults: 100 };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const { data } = await api.post("/rest/api/3/search/jql", body, { headers });
    all.push(...(data.issues || []));
    if (data.isLast || !data.nextPageToken) break;
    nextPageToken = data.nextPageToken;
  }
  return all;
}

async function addLabel(key, labels) {
  const headers = authHeader();
  await api.put(`/rest/api/3/issue/${key}`, { fields: { labels } }, { headers });
}

async function mapWithConcurrency(items, limit, fn) {
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`=== HDV "${LABEL}" etiketi ekleme ===`);
  console.log(`Jira: ${HEBIAR_BASE_URL} | Board: ${WEEKLY_BOARD_ID} | Proje: ${PROJECT_KEY}`);
  console.log(`Mod: ${DRY_RUN ? "DRY-RUN (yazma yok)" : "GERÇEK YAZMA"}`);
  console.log(`Kişiler: ${TARGET_PEOPLE.join(", ")}`);
  console.log("");

  const sprints = await fetchSprints();
  const active = sprints.filter((s) => s.state === "active");
  const next = sprints.filter(
    (s) => normalize(s.name) === normalize(NEXT_SPRINT_NAME),
  );

  if (!active.length) console.log("UYARI: aktif sprint bulunamadı.");
  if (!next.length) console.log(`UYARI: "${NEXT_SPRINT_NAME}" sprinti bulunamadı.`);

  const selected = [...active, ...next];
  if (!selected.length) {
    console.log("Hedef sprint yok, çıkılıyor.");
    console.log("DONE");
    return;
  }
  for (const s of selected) {
    console.log(`Sprint: #${s.id} ${s.name} (${s.state})`);
  }
  console.log("");

  const sprintIds = selected.map((s) => s.id);
  const jql = `project = ${PROJECT_KEY} AND sprint in (${sprintIds.join(",")}) ORDER BY assignee ASC, key ASC`;
  console.log(`JQL: ${jql}`);

  const issues = await searchAllJql(jql, ["summary", "assignee", "labels", "status", "customfield_10020"]);
  console.log(`Sprintlerdeki toplam ${PROJECT_KEY} maddesi: ${issues.length}`);

  const targeted = [];
  const otherAssignees = new Map();
  for (const it of issues) {
    const name = it.fields?.assignee?.displayName || "";
    const person = matchPerson(name);
    if (person) {
      targeted.push({ issue: it, person, name });
    } else {
      otherAssignees.set(name || "(Atanmamış)", (otherAssignees.get(name || "(Atanmamış)") || 0) + 1);
    }
  }

  console.log(`Hedef kişilere atanmış madde: ${targeted.length}`);
  const perPerson = {};
  for (const t of targeted) perPerson[t.name] = (perPerson[t.name] || 0) + 1;
  for (const [n, c] of Object.entries(perPerson)) console.log(`  - ${n}: ${c}`);
  console.log(`Kapsam dışı atananlar: ${[...otherAssignees.entries()].map(([n, c]) => `${n}(${c})`).join(", ") || "-"}`);
  console.log("");

  const toUpdate = targeted.filter(
    (t) => !(t.issue.fields?.labels || []).includes(LABEL),
  );
  const already = targeted.length - toUpdate.length;
  console.log(`Zaten "${LABEL}" etiketli: ${already}`);
  console.log(`Güncellenecek: ${toUpdate.length}`);
  console.log("");

  let ok = 0;
  const errors = [];
  await mapWithConcurrency(toUpdate, CONCURRENCY, async (t) => {
    const key = t.issue.key;
    const current = t.issue.fields?.labels || [];
    const nextLabels = [...current, LABEL];
    const summary = (t.issue.fields?.summary || "").slice(0, 60);
    if (DRY_RUN) {
      console.log(`[DRY] ${key} | ${t.name} | ${summary} | ${current.join(",") || "-"} => +${LABEL}`);
      ok++;
      return;
    }
    try {
      await addLabel(key, nextLabels);
      ok++;
      console.log(`[OK]  ${key} | ${t.name} | ${summary} | +${LABEL}`);
    } catch (e) {
      const msg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      errors.push({ key, msg });
      console.error(`[ERR] ${key} | ${msg}`);
    }
  });

  console.log("");
  console.log(`Başarılı: ${ok} | Hatalı: ${errors.length}`);
  console.log("DONE");
}

main().catch((e) => {
  console.error("FATAL:", e.response?.data ? JSON.stringify(e.response.data) : e.message);
  console.log("DONE");
  process.exit(1);
});
