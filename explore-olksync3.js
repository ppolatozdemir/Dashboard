/**
 * Devreden maddeleri kırılımlı listeler: aktif sprintteki her maddenin
 * geçmişte hangi kapanmış sprintlerde yer aldığını gösterir.
 * Çıktı: explore-olksync3.log
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

async function main() {
  const api = client();

  const jql = `project = ${PROJECT} AND sprint = ${CURRENT} AND sprint in closedSprints() ORDER BY key ASC`;
  const issues = await searchAll(api, jql, [
    "summary",
    "status",
    "assignee",
    "customfield_10020",
  ]);
  log(`JQL: ${jql}`);
  log(`Sonuç: ${issues.length} madde\n`);

  for (const i of issues) {
    const sprints = (i.fields.customfield_10020 || []).map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
    }));
    const inPrev = sprints.some((s) => s.id === PREV);
    log(
      `${inPrev ? "   " : ">>>"} ${i.key} | ${i.fields.status?.name} | ${
        i.fields.assignee?.displayName || "Atanmamış"
      } | sprintler: ${sprints.map((s) => `${s.name}(${s.state})`).join(" , ")}`
    );
  }

  const skipped = issues.filter(
    (i) => !(i.fields.customfield_10020 || []).some((s) => s.id === PREV)
  );
  log(
    `\n>>> ile işaretli = bir ÖNCEKİ sprintte (${PREV}) yoktu, daha ESKİ bir kapanmış sprintten geldi: ${skipped.length} madde`
  );
  log("DONE");
}

main()
  .catch((e) => {
    log("FATAL:", e.response?.status, JSON.stringify(e.response?.data || e.message));
    log("DONE");
  })
  .finally(() => fs.writeFileSync("explore-olksync3.log", lines.join("\n"), "utf8"));
