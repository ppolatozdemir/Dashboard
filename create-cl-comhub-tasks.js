import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const PROJECT_KEY = "CL";
const TASK_TYPE_ID = "10029"; // "Task" (CL/Comlab next-gen)
const ASSIGNEE_ACCOUNT_ID = "557058:ab8d9e2d-396f-4c95-aea8-2fef3abafd10"; // "id"
const SPRINT_ID = 1562; // "Pasif Sprint" (future)
const SPRINT_FIELD_ID = "customfield_10020";
const MODULE_FIELD_ID = 'customfield_10081'; // "Modül"
const MODULE_VALUE_ID = '10322'; // "Commhub"
const CUSTOMER_FIELD_ID = 'customfield_10169'; // "Customer"
const CUSTOMER_VALUE_ID = '10155'; // "Commercelab"
const LOG_FILE = "create-cl-comhub-tasks.log";

const summaries = [
  "Quick Fix : ComHub Pending Queue işleyen Job sürelerinin duruma göre ayarlanması",
  "Aktifleşme & pasifleşme ayrı ve öncelikli gönderimi",
  "Fiyat gönderiminin SKC dışında ayrı gönderimi",
  "Aktarım başında POD açarak işlemi yapmak",
  "Multi Tenant aktarım çalışması F2",
  "Multi instance aktarım çalıştırma F2",
];

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

function adf(text) {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, label, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = e.response?.status;
      const retriable = status === 429 || (status >= 500 && status < 600);
      if (retriable && i < attempts) {
        const wait = 1000 * i;
        log(
          `  ⚠️ ${label} denemesi ${i} başarısız (HTTP ${status}). ${wait}ms sonra tekrar...`,
        );
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

async function main() {
  fs.writeFileSync(
    LOG_FILE,
    `# CL ComHub task oluşturma — ${new Date().toISOString()}\n`,
    "utf8",
  );
  const api = client("/rest/api/3");
  const agile = client("/rest/agile/1.0");

  log(`\n🚀 CL (Comlab) projesine ${summaries.length} task oluşturuluyor...`);
  log(`   Assignee: "id" (${ASSIGNEE_ACCOUNT_ID})`);
  log(`   Sprint: Pasif Sprint (id ${SPRINT_ID})\n`);

  const created = [];
  for (const summary of summaries) {
    try {
      const res = await withRetry(
        () =>
          api.post("/issue", {
            fields: {
              project: { key: PROJECT_KEY },
              summary,
              description: adf(summary),
              issuetype: { id: TASK_TYPE_ID },
              assignee: { accountId: ASSIGNEE_ACCOUNT_ID },
              [SPRINT_FIELD_ID]: SPRINT_ID,
              [MODULE_FIELD_ID]: { id: MODULE_VALUE_ID },
              [CUSTOMER_FIELD_ID]: { id: CUSTOMER_VALUE_ID },
            },
          }),
        `create "${summary}"`,
      );
      const key = res.data.key;

      // Sprint alanı create'te tutmazsa agile API ile de ekle (idempotent güvenlik)
      try {
        await withRetry(
          () => agile.post(`/sprint/${SPRINT_ID}/issue`, { issues: [key] }),
          `sprint add ${key}`,
        );
      } catch (e) {
        log(
          `  ⚠️ ${key} sprint agile-add uyarısı: HTTP ${e.response?.status} ${e.message}`,
        );
      }

      created.push({ key, summary });
      log(`✅ ${key} — ${summary}`);
    } catch (e) {
      log(`❌ Başarısız: ${summary} — HTTP ${e.response?.status} ${e.message}`);
      log(JSON.stringify(e.response?.data || {}, null, 2));
    }
  }

  log("\n" + "=".repeat(60));
  log(`📋 OLUŞTURULAN TASKLAR (${created.length}/${summaries.length})`);
  log("=".repeat(60));
  created.forEach((t) => log(`${t.key} | ${t.summary}`));
  log(`\n=== DONE ===`);
}

main().catch((e) => log(`FATAL: ${e.message}`));
