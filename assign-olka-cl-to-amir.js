import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

/**
 * Olka SPRINT 11082026'daki IOS + Android tasklarının CL (Hebiar) tasklarını bulur,
 * hepsini "Amir Daliri" ye atar ve "weekly260810" sprintine alır.
 *
 * Olka: E-COMM DEVELOPMENT TEAM. Task türü IOS ve Android. Sprint = SPRINT 11082026.
 * Her Olka taskının CLLINK alanından Hebiar (CL) anahtarı çıkarılır.
 *
 * Kullanım:
 *   node assign-olka-cl-to-amir.js --dry-run   # sadece önizleme
 *   node assign-olka-cl-to-amir.js             # gerçek yazma
 */

// ---- Konsolu UTF-8 log dosyasına da yaz ----
const LOG_FILE = process.env.ASSIGN_LOG_FILE || "assign-olka-cl-to-amir.log";
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

// ---- Sabitler ----
const OLKA_BASE_URL = (
  process.env.OLKA_BASE_URL || "https://olkaproduct.atlassian.net"
).replace(/\/$/, "");
const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const OLKA_PROJECT_QUERY =
  process.env.OLKA_PROJECT_QUERY || "E-COMM DEVELOPMENT TEAM";
const OLKA_SPRINT_NAME = process.env.OLKA_SPRINT_NAME || "SPRINT 18082026";
const OLKA_ISSUE_TYPES = (process.env.OLKA_ISSUE_TYPES || "IOS,Android")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const HEBIAR_WEEKLY_BOARD_ID = Number(process.env.HEBIAR_WEEKLY_BOARD_ID || 54);
const TARGET_SPRINT_NAME = process.env.TARGET_SPRINT_NAME || "weekly260817";
const ASSIGNEE_NAME = process.env.ASSIGNEE_NAME || "Amir Daliri";
const REQ_TIMEOUT = Number(process.env.ASSIGN_TIMEOUT_MS || 30000);
const CONCURRENCY = Number(process.env.ASSIGN_CONCURRENCY || 5);
const DRY_RUN =
  process.env.DRY_RUN === "1" || process.argv.includes("--dry-run");

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

// ---- HTTP yardımcıları (retry) ----
async function withRetry(fn, label, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const st = e.response?.status;
      if (st === 429 || (st >= 500 && st < 600)) {
        const wait = 800 * (i + 1);
        console.log(`   ⏳ ${label}: ${st} -> ${wait}ms sonra tekrar`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

// ---- Olka CLLINK field id ----
async function getCllinkFieldId() {
  const res = await withRetry(
    () =>
      axios.get(`${OLKA_BASE_URL}/rest/api/3/field`, {
        headers: authHeader(),
        timeout: REQ_TIMEOUT,
      }),
    "olka field list",
  );
  const fields = res.data || [];
  const field =
    fields.find((f) => (f.name || "").trim().toLowerCase() === "cllink") ||
    fields.find((f) => (f.name || "").toLowerCase().includes("cllink"));
  return field ? field.id : null;
}

function extractClKey(value) {
  if (!value) return null;
  const str = typeof value === "string" ? value : JSON.stringify(value);
  const match = str.match(/([A-Z][A-Z0-9]+-\d+)/);
  return match ? match[1] : null;
}

// ---- Enhanced JQL (nextPageToken sayfalı) ----
async function searchAllJql(baseUrl, jql, fields) {
  let nextPageToken = null;
  const all = [];
  do {
    const params = { jql, fields: fields.join(","), maxResults: 100 };
    if (nextPageToken) params.nextPageToken = nextPageToken;
    const res = await withRetry(
      () =>
        axios.get(`${baseUrl}/rest/api/3/search/jql`, {
          params,
          headers: authHeader(),
          timeout: REQ_TIMEOUT,
        }),
      "search/jql",
    );
    all.push(...(res.data.issues || []));
    nextPageToken = res.data.isLast ? null : res.data.nextPageToken || null;
  } while (nextPageToken);
  return all;
}

// ---- Amir Daliri accountId çöz ----
function normName(s) {
  return (s || "")
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveAssignee(name) {
  const queries = new Set([name, name.split(/\s+/)[0]]);
  const candidates = [];
  const seen = new Set();
  for (const q of queries) {
    if (!q) continue;
    const res = await withRetry(
      () =>
        axios.get(`${HEBIAR_BASE_URL}/rest/api/3/user/search`, {
          params: { query: q, maxResults: 50 },
          headers: authHeader(),
          timeout: REQ_TIMEOUT,
        }),
      `user/search(${q})`,
    );
    for (const u of res.data || []) {
      if (u.accountId && !seen.has(u.accountId)) {
        seen.add(u.accountId);
        candidates.push(u);
      }
    }
  }
  const wanted = normName(name);
  let hit =
    candidates.find(
      (u) =>
        u.accountType === "atlassian" && normName(u.displayName) === wanted,
    ) ||
    candidates.find(
      (u) =>
        u.accountType === "atlassian" &&
        normName(u.displayName).includes(wanted),
    ) ||
    candidates.find((u) => normName(u.displayName) === wanted);
  return { hit, candidates };
}

// ---- Hedef sprint (Hebiar board 54) ----
async function findTargetSprint(name) {
  const states = "active,future,closed";
  let startAt = 0;
  const wanted = name.trim().toLowerCase();
  while (true) {
    const res = await withRetry(
      () =>
        axios.get(
          `${HEBIAR_BASE_URL}/rest/agile/1.0/board/${HEBIAR_WEEKLY_BOARD_ID}/sprint`,
          {
            params: { state: states, startAt, maxResults: 50 },
            headers: authHeader(),
            timeout: REQ_TIMEOUT,
          },
        ),
      "board sprints",
    );
    const values = res.data.values || [];
    const match = values.find(
      (s) => (s.name || "").trim().toLowerCase() === wanted,
    );
    if (match) return match;
    if (res.data.isLast || values.length === 0) break;
    startAt += values.length;
  }
  return null;
}

// ---- CL anahtarlarını Hebiar'da doğrula ----
async function validateKeys(keys) {
  const found = new Set();
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const jql = `key in (${chunk.map((k) => `"${k}"`).join(",")})`;
    const issues = await searchAllJql(HEBIAR_BASE_URL, jql, ["key"]);
    issues.forEach((it) => found.add(it.key));
  }
  return found;
}

async function assignIssue(key, accountId) {
  await withRetry(
    () =>
      axios.put(
        `${HEBIAR_BASE_URL}/rest/api/3/issue/${key}/assignee`,
        { accountId },
        { headers: authHeader(), timeout: REQ_TIMEOUT },
      ),
    `assign ${key}`,
  );
}

async function moveIssuesToSprint(sprintId, keys) {
  // Agile API: en fazla 50 issue / istek
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    await withRetry(
      () =>
        axios.post(
          `${HEBIAR_BASE_URL}/rest/agile/1.0/sprint/${sprintId}/issue`,
          { issues: chunk },
          { headers: authHeader(), timeout: REQ_TIMEOUT },
        ),
      `sprint move chunk ${i}`,
    );
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await worker(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main() {
  console.log("=".repeat(64));
  console.log(
    `Olka ${OLKA_SPRINT_NAME} (IOS+Android) CL taskları -> ${ASSIGNEE_NAME} + ${TARGET_SPRINT_NAME}`,
  );
  console.log("Olka   :", OLKA_BASE_URL, "|", OLKA_PROJECT_QUERY);
  console.log(
    "Sprint :",
    OLKA_SPRINT_NAME,
    "| Türler:",
    OLKA_ISSUE_TYPES.join(", "),
  );
  console.log("Hebiar :", HEBIAR_BASE_URL);
  console.log(
    "Hedef  :",
    ASSIGNEE_NAME,
    "|",
    TARGET_SPRINT_NAME,
    `(board ${HEBIAR_WEEKLY_BOARD_ID})`,
  );
  console.log("Mod    :", DRY_RUN ? "DRY-RUN (yazma yok)" : "GERÇEK YAZMA");
  console.log("=".repeat(64));

  // 1) CLLINK field id
  const cllinkId = await getCllinkFieldId();
  if (!cllinkId) throw new Error("Olka'da CLLINK alanı bulunamadı.");
  console.log("CLLINK alanı:", cllinkId);

  // 2) Olka taskları
  const typeList = OLKA_ISSUE_TYPES.map((t) => `"${t}"`).join(",");
  const jql = `project = "${OLKA_PROJECT_QUERY}" AND issuetype in (${typeList}) AND sprint = "${OLKA_SPRINT_NAME}" ORDER BY key`;
  console.log("\nOlka JQL:", jql);
  const olkaIssues = await searchAllJql(OLKA_BASE_URL, jql, [
    "key",
    "summary",
    "issuetype",
    cllinkId,
  ]);
  console.log(`Olka task sayısı: ${olkaIssues.length}`);

  // 3) CL anahtarları çıkar
  const rows = [];
  const noLink = [];
  for (const it of olkaIssues) {
    const clKey = extractClKey(it.fields[cllinkId]);
    const info = {
      olkaKey: it.key,
      summary: it.fields.summary || "",
      type: it.fields.issuetype?.name || "",
      clKey,
    };
    if (clKey) rows.push(info);
    else noLink.push(info);
  }

  console.log(
    `\nCL bağlantısı olan: ${rows.length} | CLLINK yok: ${noLink.length}`,
  );
  for (const r of rows) {
    console.log(`  ${r.olkaKey} [${r.type}] -> ${r.clKey}  | ${r.summary}`);
  }
  if (noLink.length) {
    console.log("\n⚠️ CLLINK'i olmayan Olka taskları (atlanacak):");
    for (const r of noLink)
      console.log(`  ${r.olkaKey} [${r.type}] | ${r.summary}`);
  }

  // Benzersiz CL anahtarları
  const clKeys = [...new Set(rows.map((r) => r.clKey))];
  console.log(`\nBenzersiz CL anahtarı: ${clKeys.length}`);

  if (clKeys.length === 0) {
    console.log("\nİşlenecek CL taskı yok. Çıkılıyor.");
    console.log(`Log: ${LOG_FILE}`);
    return;
  }

  // 4) Amir Daliri çöz
  console.log(`\n👤 "${ASSIGNEE_NAME}" çözümleniyor...`);
  const { hit, candidates } = await resolveAssignee(ASSIGNEE_NAME);
  if (!hit) {
    console.log(
      `  ✗ Çözülemedi. Aday: ${candidates.map((c) => c.displayName).join(", ") || "yok"}`,
    );
    throw new Error(`"${ASSIGNEE_NAME}" Hebiar'da bulunamadı.`);
  }
  console.log(
    `  ✓ ${hit.displayName} <${hit.emailAddress || "e-posta gizli"}> (${hit.accountId})`,
  );

  // 5) Hedef sprint
  console.log(
    `\n🏃 "${TARGET_SPRINT_NAME}" sprinti aranıyor (board ${HEBIAR_WEEKLY_BOARD_ID})...`,
  );
  const sprint = await findTargetSprint(TARGET_SPRINT_NAME);
  if (!sprint) throw new Error(`"${TARGET_SPRINT_NAME}" sprinti bulunamadı.`);
  console.log(`  ✓ ${sprint.name} (id ${sprint.id}, state ${sprint.state})`);

  // 6) CL anahtarlarını doğrula
  console.log("\n🔎 CL anahtarları Hebiar'da doğrulanıyor...");
  const foundKeys = await validateKeys(clKeys);
  const missing = clKeys.filter((k) => !foundKeys.has(k));
  const validKeys = clKeys.filter((k) => foundKeys.has(k));
  console.log(
    `  Bulundu: ${foundKeys.size}/${clKeys.length}` +
      (missing.length ? ` | EKSİK: ${missing.join(", ")}` : ""),
  );

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Değişiklik yapılmadı.");
    console.log(`  Atanacak/sprinte alınacak: ${validKeys.length} CL taskı`);
    console.log(`  -> Assignee: ${hit.displayName}`);
    console.log(`  -> Sprint  : ${sprint.name} (${sprint.id})`);
    console.log(`Log: ${LOG_FILE}`);
    return;
  }

  if (validKeys.length === 0) {
    console.log("\nGeçerli CL taskı yok. Çıkılıyor.");
    console.log(`Log: ${LOG_FILE}`);
    return;
  }

  // 7a) Atama
  console.log("\n📝 Atama uygulanıyor...");
  let assigned = 0,
    assignFailed = 0;
  const failures = [];
  await mapWithConcurrency(validKeys, CONCURRENCY, async (key) => {
    try {
      await assignIssue(key, hit.accountId);
      assigned++;
      console.log(`  ✅ ${key} -> ${hit.displayName}`);
    } catch (e) {
      assignFailed++;
      failures.push(`assign ${key}: ${e.response?.status || e.message}`);
      console.log(`  ❌ ${key} atama: ${e.response?.status || e.message}`);
    }
  });

  // 7b) Sprinte alma (toplu)
  console.log("\n📥 Sprinte alınıyor...");
  let movedOk = false;
  try {
    await moveIssuesToSprint(sprint.id, validKeys);
    movedOk = true;
    console.log(
      `  ✅ ${validKeys.length} task ${sprint.name} sprintine alındı`,
    );
  } catch (e) {
    failures.push(`sprint move: ${e.response?.status || e.message}`);
    console.log(
      `  ❌ Sprinte alma: ${e.response?.status || JSON.stringify(e.response?.data) || e.message}`,
    );
  }

  console.log("\n" + "=".repeat(64));
  console.log("ÖZET");
  console.log("=".repeat(64));
  console.log(`Olka task           : ${olkaIssues.length}`);
  console.log(
    `CL bağlantılı        : ${rows.length} (benzersiz ${clKeys.length})`,
  );
  console.log(`Hebiar'da bulunan    : ${validKeys.length}`);
  console.log(`Atandı (${hit.displayName}) : ${assigned}`);
  console.log(`Atama hata          : ${assignFailed}`);
  console.log(`Sprinte alındı      : ${movedOk ? validKeys.length : 0}`);
  if (missing.length)
    console.log(`Hebiar'da YOK       : ${missing.join(", ")}`);
  if (failures.length) {
    console.log("\nHatalar:");
    failures.forEach((f) => console.log("  - " + f));
  }
  console.log(`\nLog: ${LOG_FILE}`);
}

main().catch((e) => {
  console.error("HATA:", e.response?.data || e.message);
  process.exit(1);
});
