import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");

const LOG = "explore-mc.log";
const lines = [];
function log(...a) {
  const s = a
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2)))
    .join(" ");
  lines.push(s);
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

async function main() {
  const headers = authHeader();

  // 1) Project info
  try {
    const proj = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/project/MC`, {
      headers,
    });
    log("PROJECT:", {
      key: proj.data.key,
      name: proj.data.name,
      id: proj.data.id,
      style: proj.data.style,
      simplified: proj.data.simplified,
    });
  } catch (e) {
    log("PROJECT ERROR:", e.response?.status, JSON.stringify(e.response?.data || e.message));
  }

  // 2) Boards for MC
  let boards = [];
  try {
    const res = await axios.get(`${HEBIAR_BASE_URL}/rest/agile/1.0/board`, {
      params: { projectKeyOrId: "MC" },
      headers,
    });
    boards = res.data.values || [];
    log("BOARDS:", boards.map((b) => ({ id: b.id, name: b.name, type: b.type })));
  } catch (e) {
    log("BOARDS ERROR:", e.response?.status, JSON.stringify(e.response?.data || e.message));
  }

  // 3) Board configuration (columns + mapped statuses) for each board
  for (const b of boards) {
    try {
      const res = await axios.get(
        `${HEBIAR_BASE_URL}/rest/agile/1.0/board/${b.id}/configuration`,
        { headers },
      );
      const cols = (res.data.columnConfig?.columns || []).map((c) => ({
        name: c.name,
        statusIds: (c.statuses || []).map((s) => s.id),
      }));
      log(`BOARD ${b.id} (${b.name}) COLUMNS:`, cols);
    } catch (e) {
      log(
        `BOARD ${b.id} CONFIG ERROR:`,
        e.response?.status,
        JSON.stringify(e.response?.data || e.message),
      );
    }
  }

  // 4) All statuses used by MC project (name -> id -> category)
  try {
    const res = await axios.get(
      `${HEBIAR_BASE_URL}/rest/api/3/project/MC/statuses`,
      { headers },
    );
    const map = {};
    for (const it of res.data || []) {
      for (const s of it.statuses || []) {
        map[s.id] = { name: s.name, category: s.statusCategory?.key };
      }
    }
    log("PROJECT STATUSES (id -> name/category):", map);
  } catch (e) {
    log("PROJECT STATUSES ERROR:", e.response?.status, JSON.stringify(e.response?.data || e.message));
  }

  // 5) Count issues per status via Enhanced JQL (all MC issues)
  try {
    const counts = {};
    let nextPageToken = null;
    let pages = 0;
    let total = 0;
    do {
      const params = {
        jql: "project = MC ORDER BY key ASC",
        fields: "status",
        maxResults: 100,
      };
      if (nextPageToken) params.nextPageToken = nextPageToken;
      const res = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/search/jql`, {
        params,
        headers,
      });
      for (const iss of res.data.issues || []) {
        const st = iss.fields?.status?.name || "?";
        counts[st] = (counts[st] || 0) + 1;
        total++;
      }
      nextPageToken = res.data.isLast ? null : res.data.nextPageToken || null;
      pages++;
    } while (nextPageToken && pages < 60);
    log("ISSUE COUNT BY STATUS:", counts);
    log("TOTAL MC ISSUES:", total);
  } catch (e) {
    log("COUNT ERROR:", e.response?.status, JSON.stringify(e.response?.data || e.message));
  }

  fs.writeFileSync(LOG, lines.join("\n") + "\nDONE\n", "utf8");
  console.log("DONE - wrote", LOG);
}

main().catch((e) => {
  fs.writeFileSync(LOG, lines.join("\n") + "\nFATAL: " + e.message + "\n", "utf8");
  console.error("FATAL", e.message);
});
