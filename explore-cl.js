import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const PROJECT_KEY = "CL";
const LOG_FILE = "explore-cl.log";

function log(line) {
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

function client(api) {
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

async function main() {
  fs.writeFileSync(
    LOG_FILE,
    `# CL explore — ${new Date().toISOString()}\n`,
    "utf8",
  );
  const api = client("/rest/api/3");
  const agile = client("/rest/agile/1.0");

  // 1) Project info
  try {
    const p = await api.get(`/project/${PROJECT_KEY}`);
    log(`\n== PROJECT ${PROJECT_KEY} ==`);
    log(
      `id=${p.data.id} name="${p.data.name}" style=${p.data.style} type=${p.data.projectTypeKey}`,
    );
  } catch (e) {
    log(
      `Project ${PROJECT_KEY} fetch error: HTTP ${e.response?.status} ${e.message}`,
    );
    log(JSON.stringify(e.response?.data || {}, null, 2));
  }

  // 2) Issue types for CL
  try {
    const st = await api.get(`/project/${PROJECT_KEY}/statuses`);
    log(`\n== ISSUE TYPES (from statuses) ==`);
    (st.data || []).forEach((it) => log(`  type "${it.name}" id=${it.id}`));
  } catch (e) {
    log(`statuses error: HTTP ${e.response?.status} ${e.message}`);
  }

  // 3) Boards for CL
  let boards = [];
  try {
    const b = await agile.get("/board", {
      params: { projectKeyOrId: PROJECT_KEY, maxResults: 50 },
    });
    boards = b.data.values || [];
    log(`\n== BOARDS (projectKeyOrId=${PROJECT_KEY}) ==`);
    boards.forEach((bd) =>
      log(`  board id=${bd.id} name="${bd.name}" type=${bd.type}`),
    );
  } catch (e) {
    log(`boards error: HTTP ${e.response?.status} ${e.message}`);
  }

  // 4) Sprints on each scrum board
  for (const bd of boards.filter((x) => x.type === "scrum")) {
    for (const state of ["active", "future", "closed"]) {
      try {
        const s = await agile.get(`/board/${bd.id}/sprint`, {
          params: { state, maxResults: 50 },
        });
        const sprints = s.data.values || [];
        log(
          `\n== BOARD ${bd.id} "${bd.name}" SPRINTS state=${state} (${sprints.length}) ==`,
        );
        sprints.forEach((sp) =>
          log(
            `  sprint id=${sp.id} name="${sp.name}" state=${sp.state} originBoardId=${sp.originBoardId} start=${sp.startDate || ""} end=${sp.endDate || ""}`,
          ),
        );
      } catch (e) {
        log(
          `  board ${bd.id} ${state} sprints error: HTTP ${e.response?.status} ${e.message}`,
        );
      }
    }
  }

  // 5) Search for "ID" user
  for (const q of ["ID", "id", "commercelab"]) {
    try {
      const u = await api.get("/user/search", {
        params: { query: q, maxResults: 20 },
      });
      log(`\n== USER SEARCH query="${q}" (${u.data.length}) ==`);
      (u.data || []).forEach((usr) =>
        log(
          `  accountId=${usr.accountId} displayName="${usr.displayName}" email=${usr.emailAddress || ""} type=${usr.accountType} active=${usr.active}`,
        ),
      );
    } catch (e) {
      log(`user search "${q}" error: HTTP ${e.response?.status} ${e.message}`);
    }
  }

  log("\n=== DONE ===");
}

main().catch((e) => log(`FATAL: ${e.message}`));
