/**
 * OLK (olka-sync) — aktif sprint ile bir önceki (son kapanan) sprint arasındaki
 * devreden (carryover) madde sayısını doğrular.
 * Çıktı: explore-olksync2.log
 */
import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const BOARD = Number(process.env.HEBIAR_WEEKLY_BOARD_ID || 54);
const PROJECT = process.env.OLK_PROJECT || "OLK";

const lines = [];
function log(...a) {
  const s = a
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2)))
    .join(" ");
  lines.push(s);
  console.log(s);
}

function client(api = "/rest/api/3") {
  const { email, apiToken } = getConfig();
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return axios.create({
    baseURL: `${HEBIAR_BASE_URL}${api}`,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });
}

async function allSprints(agile, state) {
  let startAt = 0;
  const out = [];
  while (true) {
    const r = await agile.get(`/board/${BOARD}/sprint`, {
      params: { state, startAt, maxResults: 50 },
    });
    out.push(...(r.data.values || []));
    if (r.data.isLast || (r.data.values || []).length === 0) break;
    startAt += 50;
  }
  return out.filter((s) => s.originBoardId === BOARD);
}

async function count(api, jql) {
  const r = await api.post("/search/approximate-count", { jql });
  return r.data?.count;
}

async function main() {
  const api = client();
  const agile = client("/rest/agile/1.0");

  const active = await allSprints(agile, "active");
  const closed = await allSprints(agile, "closed");
  const future = await allSprints(agile, "future");

  closed.sort((a, b) => {
    const d = (s) => new Date(s.completeDate || s.endDate || s.startDate || 0).getTime();
    return d(b) - d(a);
  });

  log("Aktif sprint(ler):", active.map((s) => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate })));
  log("Son 5 kapanan sprint:", closed.slice(0, 5).map((s) => ({ id: s.id, name: s.name, completeDate: s.completeDate })));
  log("Gelecek sprintler:", future.slice(0, 5).map((s) => ({ id: s.id, name: s.name })));

  const cur = active[0];
  const prev = closed[0];
  if (!cur || !prev) {
    log("Aktif veya kapanan sprint bulunamadı");
    log("DONE");
    return;
  }

  const tests = [
    [`Aktif sprint "${cur.name}" toplam`, `project = ${PROJECT} AND sprint = ${cur.id}`],
    [`Önceki sprint "${prev.name}" toplam`, `project = ${PROJECT} AND sprint = ${prev.id}`],
    [
      `DEVREDEN (her iki sprintte de): ${prev.name} -> ${cur.name}`,
      `project = ${PROJECT} AND sprint = ${cur.id} AND sprint = ${prev.id}`,
    ],
    [
      `Aktif sprintte YENİ (önceki sprintte yoktu)`,
      `project = ${PROJECT} AND sprint = ${cur.id} AND sprint != ${prev.id}`,
    ],
    [
      `DEVREDEN (herhangi bir kapanmış sprintten)`,
      `project = ${PROJECT} AND sprint = ${cur.id} AND sprint in closedSprints()`,
    ],
    [
      `Önceki sprintten devreden ve HALA açık`,
      `project = ${PROJECT} AND sprint = ${cur.id} AND sprint = ${prev.id} AND statusCategory != Done`,
    ],
  ];

  for (const [label, jql] of tests) {
    try {
      log(`${label}: ${await count(api, jql)}\n   JQL: ${jql}`);
    } catch (e) {
      log(`${label}: HATA ${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
    }
  }

  // İsimle de dene (kopyala-yapıştır JQL için)
  const nameJql = `project = ${PROJECT} AND sprint = "${cur.name}" AND sprint = "${prev.name}"`;
  try {
    log(`İsimle DEVREDEN: ${await count(api, nameJql)}\n   JQL: ${nameJql}`);
  } catch (e) {
    log(`İsimle DEVREDEN: HATA ${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
  }

  log("DONE");
}

main()
  .catch((e) => {
    log("FATAL:", e.response?.status, JSON.stringify(e.response?.data || e.message));
    log("DONE");
  })
  .finally(() => fs.writeFileSync("explore-olksync2.log", lines.join("\n"), "utf8"));
