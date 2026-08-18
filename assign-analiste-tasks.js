import axios from "axios";
import fs from "fs";
import JSZip from "jszip";
import { getConfig } from "./src/lib/config.js";

/**
 * Analiste (Excel) -> Hebiar TOPLU ATAMA + PLATFORM ETİKETİ
 *
 * jira-search *.xlsx dosyasının "Analiste" sayfasını okur. Her satırda:
 *   Anahtar (HDV-xxx), Atanan Kişi, Platform
 * Her HDV taskını Excel'deki kişiye ATAR ve Platform değerini task'a
 * LABEL olarak EKLER (mevcut etiketler silinmez).
 *
 * Hebiar'a (hebiar.atlassian.net) doğrudan bağlanır (config.baseUrl Olka olsa bile).
 * Kimlik: config'teki email + apiToken (iki Jira için de geçerli).
 *
 * Kullanım:
 *   node assign-analiste-tasks.js ["<dosya.xlsx>"]            # gerçek yazma
 *   node assign-analiste-tasks.js --dry-run ["<dosya.xlsx>"]  # sadece önizleme
 */

// ---- Konsolu UTF-8 log dosyasına da yaz ----
const LOG_FILE = process.env.ASSIGN_LOG_FILE || "assign-analiste.log";
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
const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const SHEET_NAME = process.env.ANALISTE_SHEET || "Analiste";
const CONCURRENCY = Number(process.env.ASSIGN_CONCURRENCY || 5);
const REQ_TIMEOUT = Number(process.env.ASSIGN_TIMEOUT_MS || 30000);
const DRY_RUN =
  process.env.DRY_RUN === "1" || process.argv.includes("--dry-run");

const XLSX_PATH =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ||
  "C:/Users/Commercelab/Downloads/jira-search-cb05c18e-42ca-4ca9-b961-5762c68379ee.xlsx";

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

// ---- xlsx okuma (jszip + regex; ExcelJS bu dosyaları okuyamıyor) ----
function colToIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

async function loadSheetRows(file, sheetName) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));

  const shared = [];
  const ssFile = zip.file("xl/sharedStrings.xml");
  if (ssFile) {
    const ssXml = await ssFile.async("string");
    const siRe = /<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g;
    let m;
    while ((m = siRe.exec(ssXml))) {
      const tRe = /<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
      let t,
        text = "";
      while ((t = tRe.exec(m[1]))) text += t[1];
      shared.push(decodeXml(text));
    }
  }

  const wbXml = await zip.file("xl/workbook.xml").async("string");
  const sheetDefs = [];
  const shRe = /<(?:\w+:)?sheet\s+([^>]*?)\/?>/g;
  let sm;
  while ((sm = shRe.exec(wbXml))) {
    const attrs = sm[1];
    const name = /name="([^"]*)"/.exec(attrs)?.[1];
    const rid = /r:id="([^"]*)"/.exec(attrs)?.[1];
    sheetDefs.push({ name: decodeXml(name || ""), rid });
  }

  const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const relMap = {};
  const relRe = /<Relationship\s+([^>]*?)\/?>/g;
  let rm;
  while ((rm = relRe.exec(relsXml))) {
    const id = /Id="([^"]*)"/.exec(rm[1])?.[1];
    const target = /Target="([^"]*)"/.exec(rm[1])?.[1];
    if (id && target) relMap[id] = target.replace(/^\/?xl\//, "").replace(/^\//, "");
  }

  const def =
    sheetDefs.find((s) => s.name.toLowerCase() === sheetName.toLowerCase()) ||
    sheetDefs.find((s) => s.name.toLowerCase().includes(sheetName.toLowerCase()));
  if (!def) throw new Error(`"${sheetName}" sayfası bulunamadı.`);

  const target = relMap[def.rid];
  const full = target.startsWith("xl/") ? target : `xl/${target}`;
  const sheetXml = await zip.file(full).async("string");

  const rows = [];
  const rowRe = /<(?:\w+:)?row[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rrm;
  while ((rrm = rowRe.exec(sheetXml))) {
    const cellRe = /<(?:\w+:)?c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
    let cm;
    const cells = [];
    while ((cm = cellRe.exec(rrm[1]))) {
      const attrs = cm[1],
        body = cm[2] || "";
      const rMatch = /r="([A-Z]+)\d+"/.exec(attrs);
      const tMatch = /t="([^"]+)"/.exec(attrs);
      const type = tMatch ? tMatch[1] : "n";
      const idx = rMatch ? colToIndex(rMatch[1]) : cells.length;
      let value = "";
      if (type === "s") {
        const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body);
        value = v ? shared[parseInt(v[1], 10)] : "";
      } else if (type === "inlineStr") {
        const v = /<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/.exec(body);
        value = v ? decodeXml(v[1]) : "";
      } else {
        const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body);
        value = v ? decodeXml(v[1]) : "";
      }
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

// ---- İsim / platform normalizasyonu ----
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

// Excel'de tutarsız yazılmış isimler -> Hebiar'da aranacak kanonik ad.
const NAME_ALIASES = {
  "burak selcuk": "Burak Selçuk",
  "gokhan kocak": "Gökhan Koçak",
  "serkan doksoz": "Serkan Doksöz",
  "alper ozcelik": "Alper Özçelik",
};

// Platform -> label (tek kelime, ilk harf büyük). "app" -> "App".
function normPlatform(p) {
  const t = (p || "").trim().replace(/\s+/g, "");
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
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

async function searchHebiarUsers(query) {
  const res = await withRetry(
    () =>
      axios.get(`${HEBIAR_BASE_URL}/rest/api/3/user/search`, {
        params: { query, maxResults: 50 },
        headers: authHeader(),
        timeout: REQ_TIMEOUT,
      }),
    `user/search(${query})`,
  );
  return res.data || [];
}

async function resolveAssignee(rawName) {
  const key = normName(rawName);
  const canonical = NAME_ALIASES[key] || rawName;
  // Aday havuzu: hem kanonik hem ilk isimle ara (diyakritik farklarını atlamak için).
  const queries = new Set([
    canonical,
    canonical.split(/\s+/)[0],
    rawName,
    rawName.split(/\s+/)[0],
  ]);
  const candidates = [];
  const seen = new Set();
  for (const q of queries) {
    if (!q) continue;
    let users = [];
    try {
      users = await searchHebiarUsers(q);
    } catch (e) {
      console.log(`   ⚠️ "${q}" araması başarısız: ${e.response?.status || e.message}`);
    }
    for (const u of users) {
      if (u.accountId && !seen.has(u.accountId)) {
        seen.add(u.accountId);
        candidates.push(u);
      }
    }
  }
  const wanted = normName(canonical);
  // 1) tam normalize eşleşme
  let hit = candidates.find(
    (u) => u.accountType === "atlassian" && normName(u.displayName) === wanted,
  );
  // 2) diyakritiksiz "içerir"
  if (!hit)
    hit = candidates.find(
      (u) => u.accountType === "atlassian" && normName(u.displayName).includes(wanted),
    );
  // 3) atlassian olmasa da tam eşleşme
  if (!hit) hit = candidates.find((u) => normName(u.displayName) === wanted);
  return { hit, candidates };
}

// ---- Task işlemleri ----
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

async function addLabel(key, label) {
  await withRetry(
    () =>
      axios.put(
        `${HEBIAR_BASE_URL}/rest/api/3/issue/${key}`,
        { update: { labels: [{ add: label }] } },
        { headers: authHeader(), timeout: REQ_TIMEOUT },
      ),
    `label ${key}`,
  );
}

/** JQL "key in (...)" ile verilen anahtarların Hebiar'da var olduğunu doğrular. */
async function validateKeys(keys) {
  const found = new Set();
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const jql = `key in (${chunk.join(",")})`;
    let nextPageToken = null;
    do {
      const params = { jql, fields: "key", maxResults: 100 };
      if (nextPageToken) params.nextPageToken = nextPageToken;
      const res = await withRetry(
        () =>
          axios.get(`${HEBIAR_BASE_URL}/rest/api/3/search/jql`, {
            params,
            headers: authHeader(),
            timeout: REQ_TIMEOUT,
          }),
        `validate chunk ${i}`,
      );
      (res.data.issues || []).forEach((it) => found.add(it.key));
      nextPageToken = res.data.isLast ? null : res.data.nextPageToken || null;
    } while (nextPageToken);
  }
  return found;
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

// ---- Ana akış ----
async function main() {
  console.log("=".repeat(64));
  console.log("Analiste -> Hebiar atama + platform etiketi");
  console.log("Dosya:", XLSX_PATH);
  console.log("Hebiar:", HEBIAR_BASE_URL);
  console.log("Mod:", DRY_RUN ? "DRY-RUN (yazma yok)" : "GERÇEK YAZMA");
  console.log("=".repeat(64));

  const rawRows = await loadSheetRows(XLSX_PATH, SHEET_NAME);
  const header = rawRows[0].map((h) => (h || "").trim());
  const iKey = header.indexOf("Anahtar");
  const iAssignee = header.indexOf("Atanan Kişi");
  const iPlatform = header.indexOf("Platform");
  if (iKey < 0 || iAssignee < 0 || iPlatform < 0) {
    throw new Error(
      `Beklenen kolonlar bulunamadı. Başlık: ${JSON.stringify(header)}`,
    );
  }

  const tasks = [];
  for (let i = 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    const key = (r[iKey] || "").trim();
    const assignee = (r[iAssignee] || "").trim();
    const platform = normPlatform(r[iPlatform]);
    if (!key) continue;
    tasks.push({ key, assignee, platform, rawPlatform: (r[iPlatform] || "").trim() });
  }
  console.log(`\nToplam task: ${tasks.length}`);

  // Benzersiz atanan kişileri çöz
  const uniqueNames = [...new Set(tasks.map((t) => t.assignee))].filter(Boolean);
  console.log(`\n👤 Atanan kişiler çözümleniyor (${uniqueNames.length})...`);
  const userMap = {};
  for (const name of uniqueNames) {
    const { hit, candidates } = await resolveAssignee(name);
    if (hit) {
      userMap[name] = hit.accountId;
      console.log(
        `  ✓ "${name}" -> ${hit.displayName} <${hit.emailAddress || "e-posta gizli"}> (${hit.accountId})`,
      );
    } else {
      console.log(
        `  ✗ "${name}" ÇÖZÜLEMEDİ. Aday sayısı: ${candidates.length}` +
          (candidates.length
            ? " -> " + candidates.slice(0, 5).map((c) => c.displayName).join(", ")
            : ""),
      );
    }
  }

  // Platform label özeti
  const platformCounts = {};
  for (const t of tasks)
    platformCounts[t.platform] = (platformCounts[t.platform] || 0) + 1;
  console.log("\n🏷️  Platform etiketleri:");
  for (const [p, c] of Object.entries(platformCounts))
    console.log(`  ${p || "(boş)"}: ${c}`);

  // Anahtarların Hebiar'da varlığını doğrula
  const keys = tasks.map((t) => t.key);
  console.log("\n🔎 Anahtarlar Hebiar'da doğrulanıyor...");
  let foundKeys = new Set();
  try {
    foundKeys = await validateKeys(keys);
  } catch (e) {
    console.log("  ⚠️ Doğrulama başarısız:", e.response?.status || e.message);
  }
  const missing = keys.filter((k) => !foundKeys.has(k));
  console.log(
    `  Bulundu: ${foundKeys.size}/${keys.length}` +
      (missing.length ? ` | EKSİK: ${missing.join(", ")}` : ""),
  );

  const unresolved = uniqueNames.filter((n) => !userMap[n]);
  if (unresolved.length) {
    console.log(
      `\n⚠️ Çözülemeyen kişiler: ${unresolved.join(", ")} — bu kişilerin taskları ATANMAYACAK (etiket yine de eklenecek).`,
    );
  }

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Hiçbir değişiklik yapılmadı. Plan yukarıdaki gibi.");
    console.log(`Log: ${LOG_FILE}`);
    return;
  }

  // Gerçek yazma
  console.log("\n📝 Uygulanıyor...\n");
  let assigned = 0,
    assignSkipped = 0,
    assignFailed = 0,
    labeled = 0,
    labelFailed = 0,
    skippedMissing = 0;
  const failures = [];

  await mapWithConcurrency(tasks, CONCURRENCY, async (t) => {
    if (!foundKeys.has(t.key)) {
      skippedMissing++;
      console.log(`⏭️  ${t.key}: Hebiar'da yok, atlandı`);
      return;
    }
    // Atama
    const accountId = userMap[t.assignee];
    if (accountId) {
      try {
        await assignIssue(t.key, accountId);
        assigned++;
      } catch (e) {
        assignFailed++;
        failures.push(`assign ${t.key}: ${e.response?.status || e.message}`);
        console.log(`❌ ${t.key} atama: ${e.response?.status || e.message}`);
      }
    } else {
      assignSkipped++;
    }
    // Etiket
    if (t.platform) {
      try {
        await addLabel(t.key, t.platform);
        labeled++;
      } catch (e) {
        labelFailed++;
        failures.push(`label ${t.key}: ${e.response?.status || e.message}`);
        console.log(`❌ ${t.key} etiket: ${e.response?.status || e.message}`);
      }
    }
    console.log(
      `✅ ${t.key} -> ${accountId ? t.assignee : "(atama yok)"} | +${t.platform}`,
    );
  });

  console.log("\n" + "=".repeat(64));
  console.log("ÖZET");
  console.log("=".repeat(64));
  console.log(`Atandı        : ${assigned}`);
  console.log(`Atama atlandı : ${assignSkipped} (kişi çözülemedi)`);
  console.log(`Atama hata    : ${assignFailed}`);
  console.log(`Etiketlendi   : ${labeled}`);
  console.log(`Etiket hata   : ${labelFailed}`);
  console.log(`Task yok      : ${skippedMissing}`);
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
