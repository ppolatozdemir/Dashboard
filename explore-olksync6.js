/**
 * Farkın gerçek sebebini doğrular: "Tamam" statüsü 2. sorgunun statü listesine
 * (Done) giriyor mu, yoksa madde duedate yüzünden mi düşüyor?
 * Çıktı: explore-olksync6.log
 */
import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");

const STATUS_LIST =
  '"Ready For Release","Ready For Reliase","QA TESTING",ONLIVE,Onlive,Done,"Tamamlandı",test,MERGED,MERGE';
const ONLY_A =
  "OLK-2717,OLK-3470,OLK-3494,OLK-3495,OLK-3504,OLK-3508,OLK-3509,OLK-3512,OLK-3519,OLK-975,OLK-978";

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

async function keys(api, jql) {
  const r = await api.post("/search/jql", { jql, fields: ["status", "duedate"], maxResults: 100 });
  return (r.data.issues || []).map(
    (i) => `${i.key}(${i.fields.status?.name}/${i.fields.duedate || "due YOK"})`
  );
}

async function main() {
  const api = client();

  const statusOnly = await keys(
    api,
    `key in (${ONLY_A}) AND status IN (${STATUS_LIST})`
  );
  log(`Statü kriterini GEÇENLER (${statusOnly.length}/11):`);
  log("  " + statusOnly.join("\n  "));

  const dueOnly = await keys(api, `key in (${ONLY_A}) AND duedate > -7d`);
  log(`\nDuedate kriterini GEÇENLER (${dueOnly.length}/11):`);
  log("  " + (dueOnly.join("\n  ") || "(yok)"));

  // "Tamam" ve "Done" ayrı statü mü?
  const st = await api.get("/project/OLK/statuses");
  const all = new Map();
  for (const t of st.data || [])
    for (const s of t.statuses || [])
      all.set(s.id, { id: s.id, name: s.name, category: s.statusCategory?.name });
  log(`\nOLK projesindeki statüler:`);
  for (const s of all.values()) log(`  ${s.id}  ${s.name}  [${s.category}]`);

  log("DONE");
}

main()
  .catch((e) => {
    log("FATAL:", e.response?.status, JSON.stringify(e.response?.data || e.message));
    log("DONE");
  })
  .finally(() => fs.writeFileSync("explore-olksync6.log", lines.join("\n"), "utf8"));
