import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const LOG_FILE = "explore-cl2.log";

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
    `# CL explore 2 — ${new Date().toISOString()}\n`,
    "utf8",
  );
  const api = client("/rest/api/3");
  const agile = client("/rest/agile/1.0");

  // Board 54 sprints (weekly) active+future
  for (const state of ["active", "future"]) {
    try {
      const s = await agile.get(`/board/54/sprint`, {
        params: { state, maxResults: 50 },
      });
      const sprints = s.data.values || [];
      log(`\n== BOARD 54 SPRINTS state=${state} (${sprints.length}) ==`);
      sprints.forEach((sp) =>
        log(
          `  id=${sp.id} name="${sp.name}" state=${sp.state} originBoardId=${sp.originBoardId} start=${sp.startDate || ""} end=${sp.endDate || ""}`,
        ),
      );
    } catch (e) {
      log(`board 54 ${state} error: HTTP ${e.response?.status} ${e.message}`);
    }
  }

  // Find the sprint custom field id
  let sprintFieldId = null;
  try {
    const f = await api.get("/field");
    const sprintField = (f.data || []).find(
      (x) => x.name === "Sprint" && x.schema?.custom?.includes("sprint"),
    );
    sprintFieldId = sprintField?.id;
    log(`\n== Sprint field id = ${sprintFieldId} ==`);
  } catch (e) {
    log(`field error: HTTP ${e.response?.status} ${e.message}`);
  }

  // Recent CL issues that have a sprint set, to see sprint naming
  try {
    const jql = `project = CL AND sprint is not EMPTY ORDER BY updated DESC`;
    const res = await api.get("/search/jql", {
      params: {
        jql,
        fields: `summary,status,${sprintFieldId || "sprint"}`,
        maxResults: 15,
      },
    });
    const issues = res.data.issues || [];
    log(`\n== CL issues with a sprint (${issues.length}) ==`);
    issues.forEach((it) => {
      const sp = it.fields[sprintFieldId] || it.fields.sprint;
      const spStr = Array.isArray(sp)
        ? sp.map((x) => `${x.name}#${x.id}(${x.state})`).join(", ")
        : JSON.stringify(sp);
      log(`  ${it.key} [${it.fields.status?.name}] ${spStr}`);
    });
  } catch (e) {
    log(`CL sprint issues error: HTTP ${e.response?.status} ${e.message}`);
    log(JSON.stringify(e.response?.data || {}, null, 2));
  }

  // Search any sprint named like "pasif" across all boards via issue query
  try {
    const jql = `sprint in (futureSprints()) ORDER BY updated DESC`;
    const res = await api.get("/search/jql", {
      params: { jql, fields: "summary", maxResults: 5 },
    });
    log(
      `\n== futureSprints() sample issues (${res.data.issues?.length || 0}) ==`,
    );
  } catch (e) {
    log(`futureSprints error: HTTP ${e.response?.status} ${e.message}`);
  }

  log("\n=== DONE ===");
}

main().catch((e) => log(`FATAL: ${e.message}`));
