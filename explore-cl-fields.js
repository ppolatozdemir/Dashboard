import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const LOG_FILE = "explore-cl-fields.log";

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
    `# CL create fields — ${new Date().toISOString()}\n`,
    "utf8",
  );
  const api = client("/rest/api/3");

  // Task issuetype id for CL = 10029
  const res = await api.get("/issue/createmeta/CL/issuetypes/10029", {
    params: { maxResults: 200 },
  });
  const fields = res.data.fields || res.data.values || [];
  const arr = Array.isArray(fields) ? fields : Object.values(fields);
  for (const f of arr) {
    const req = f.required ? "REQUIRED" : "optional";
    log(
      `\n[${req}] ${f.fieldId || f.key} "${f.name}" schema=${JSON.stringify(f.schema)}`,
    );
    if (f.allowedValues && f.allowedValues.length) {
      f.allowedValues
        .slice(0, 60)
        .forEach((v) =>
          log(
            `    value id=${v.id} name/value="${v.value || v.name || v.label || ""}"`,
          ),
        );
    }
  }
  log("\n=== DONE ===");
}

main().catch((e) => {
  log(`FATAL: HTTP ${e.response?.status} ${e.message}`);
  log(JSON.stringify(e.response?.data || {}, null, 2));
});
