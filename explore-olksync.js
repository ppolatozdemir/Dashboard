/**
 * Diagnostik: Hebiar Jira'da "OLK-SYNC" (veya benzeri) projeyi, board'unu,
 * aktif + son kapanan sprintini ve devreden (carryover) madde sayısını bulur.
 * Çıktı: explore-olksync.log (UTF-8, sonda DONE marker)
 */
import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");

const LOG_FILE = "explore-olksync.log";
const lines = [];
function log(...args) {
  const s = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2)))
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
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 30000,
  });
}

async function approxCount(api, jql) {
  const r = await api.post("/search/approximate-count", { jql });
  return r.data?.count;
}

async function main() {
  const api = client();
  const agile = client("/rest/agile/1.0");

  // 1) Projeleri tara, "sync" geçenleri bul
  let startAt = 0;
  const projects = [];
  while (true) {
    const r = await api.get("/project/search", {
      params: { startAt, maxResults: 100 },
    });
    projects.push(...(r.data.values || []));
    if (r.data.isLast || projects.length >= (r.data.total || 0)) break;
    startAt += 100;
  }
  log(`Toplam proje: ${projects.length}`);
  const matches = projects.filter((p) =>
    /sync|olk/i.test(`${p.key} ${p.name}`)
  );
  log(
    "Eşleşen projeler:",
    matches.map((p) => ({ id: p.id, key: p.key, name: p.name, style: p.style }))
  );

  const target =
    matches.find((p) => /sync/i.test(`${p.key}${p.name}`)) || matches[0];
  if (!target) {
    log("HEDEF PROJE BULUNAMADI");
    return;
  }
  log("HEDEF:", { id: target.id, key: target.key, name: target.name });

  // 2) Board'lar
  const boards = await agile.get("/board", {
    params: { projectKeyOrId: target.key, maxResults: 50 },
  });
  log(
    "Board'lar:",
    (boards.data.values || []).map((b) => ({
      id: b.id,
      name: b.name,
      type: b.type,
    }))
  );

  // 3) Bu projedeki maddelerin bağlı olduğu sprintler (aktif + kapanan)
  const scrumBoards = (boards.data.values || []).filter(
    (b) => b.type === "scrum"
  );
  for (const b of scrumBoards) {
    for (const state of ["active", "closed", "future"]) {
      try {
        const r = await agile.get(`/board/${b.id}/sprint`, {
          params: { state, maxResults: 50 },
        });
        const vals = r.data.values || [];
        log(
          `Board ${b.id} (${b.name}) ${state} sprint sayısı: ${vals.length}`,
          vals.slice(-8).map((s) => ({
            id: s.id,
            name: s.name,
            state: s.state,
            originBoardId: s.originBoardId,
            startDate: s.startDate,
            endDate: s.endDate,
            completeDate: s.completeDate,
          }))
        );
      } catch (e) {
        log(`Board ${b.id} ${state} hata:`, e.response?.status, e.message);
      }
    }
  }

  // 4) Weekly board 54 üzerinden de bak (bu projenin maddeleri oraya düşüyor olabilir)
  try {
    const r = await agile.get(`/board/54/sprint`, {
      params: { state: "active" },
    });
    log(
      "Board 54 aktif sprintler:",
      (r.data.values || []).map((s) => ({
        id: s.id,
        name: s.name,
        originBoardId: s.originBoardId,
      }))
    );
  } catch (e) {
    log("Board 54 hata:", e.response?.status, e.message);
  }

  // 5) Carryover sayıları
  const key = target.key;
  const tests = [
    [`Toplam madde`, `project = "${key}"`],
    [`Aktif sprintte`, `project = "${key}" AND sprint in openSprints()`],
    [
      `Aktif sprintte + daha önce kapanmış bir sprintte (DEVREDEN)`,
      `project = "${key}" AND sprint in openSprints() AND sprint in closedSprints()`,
    ],
    [
      `Aktif sprintte + hiç kapanmış sprintte olmayan (YENİ)`,
      `project = "${key}" AND sprint in openSprints() AND sprint not in closedSprints()`,
    ],
  ];
  for (const [label, jql] of tests) {
    try {
      const c = await approxCount(api, jql);
      log(`${label}: ${c}\n   JQL: ${jql}`);
    } catch (e) {
      log(
        `${label}: HATA`,
        e.response?.status,
        JSON.stringify(e.response?.data || e.message)
      );
    }
  }

  log("DONE");
}

main()
  .catch((e) => {
    log("FATAL:", e.response?.status, JSON.stringify(e.response?.data || e.message));
    log("DONE");
  })
  .finally(() => {
    fs.writeFileSync(LOG_FILE, lines.join("\n"), "utf8");
  });
