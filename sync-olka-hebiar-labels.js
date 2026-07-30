import axios from "axios";
import fs from "fs";
import { getConfig } from "./src/lib/config.js";

// Tüm konsol çıktısını UTF-8 bir log dosyasına da yaz (kabuk kodlamasından bağımsız okunabilir).
const LOG_FILE = process.env.SYNC_LOG_FILE || "sync-labels.log";
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

/**
 * Olka -> Hebiar ETİKET (label) EŞİTLEME
 *
 * Olka (E-COMM DEVELOPMENT TEAM) projesindeki her taskın etiketlerini,
 * CLLINK alanı ile eşleşen Hebiar (CL) taskına BİREBİR kopyalar.
 * "Hebiar = Olka birebir kopya": Hebiar tarafındaki fazla etiketler SİLİNİR,
 * eksik etiketler EKLENİR. Sonuçta iki taraf label olarak eşit olur.
 *
 * Olka tarafına HİÇBİR yazma yapılmaz (Olka kaynak kabul edilir).
 *
 * Her iki Jira'ya da aynı email + API token ile bağlanılır.
 *
 * Kullanım:
 *   node sync-olka-hebiar-labels.js            # gerçek yazma
 *   node sync-olka-hebiar-labels.js --dry-run  # sadece önizleme (yazma yok)
 */

const OLKA_BASE_URL = (
  process.env.OLKA_BASE_URL || "https://olkaproduct.atlassian.net"
).replace(/\/$/, "");
const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const OLKA_PROJECT_QUERY =
  process.env.OLKA_PROJECT_QUERY || "E-COMM DEVELOPMENT TEAM";
const OLKA_PROJECT_KEY = process.env.OLKA_PROJECT_KEY || "EWT";
const CLLINK_FIELD_NAME = "CLLINK";
const CONCURRENCY = Number(process.env.SYNC_CONCURRENCY || 5);
const REQ_TIMEOUT = Number(process.env.SYNC_TIMEOUT_MS || 30000);
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

/** Olka'daki CLLINK custom field id'sini bulur (customfield_XXXXX). */
async function getCllinkFieldId() {
  const res = await axios.get(`${OLKA_BASE_URL}/rest/api/3/field`, {
    headers: authHeader(),
    timeout: REQ_TIMEOUT,
  });
  const fields = res.data || [];
  const field =
    fields.find(
      (f) =>
        (f.name || "").trim().toLowerCase() === CLLINK_FIELD_NAME.toLowerCase(),
    ) || fields.find((f) => (f.name || "").toLowerCase().includes("cllink"));
  return field ? field.id : null;
}

/** CLLINK değerinden Hebiar (CL) task anahtarını çıkarır. */
function extractClKey(value) {
  if (!value) return null;
  const str = typeof value === "string" ? value : JSON.stringify(value);
  const match = str.match(/([A-Z][A-Z0-9]+-\d+)/);
  return match ? match[1] : null;
}

/** Enhanced JQL endpoint'i ile bir sorgunun TÜM sonuçlarını (sayfalı) çeker. */
async function searchAllJql(baseUrl, jql, fields) {
  const headers = authHeader();
  let nextPageToken = null;
  const all = [];
  do {
    const params = { jql, fields: fields.join(","), maxResults: 100 };
    if (nextPageToken) params.nextPageToken = nextPageToken;
    const res = await axios.get(`${baseUrl}/rest/api/3/search/jql`, {
      params,
      headers,
      timeout: REQ_TIMEOUT,
    });
    const issues = res.data.issues || [];
    all.push(...issues);
    nextPageToken = res.data.isLast ? null : res.data.nextPageToken || null;
  } while (nextPageToken);
  return all;
}

/** Verilen Hebiar anahtarlarının mevcut etiketlerini çeker. */
async function fetchHebiarLabels(clKeys) {
  const map = new Map();
  const unique = [...new Set(clKeys.filter(Boolean))];
  const chunk = 50;
  for (let i = 0; i < unique.length; i += chunk) {
    const part = unique.slice(i, i + chunk);
    const jql = `key in (${part.map((k) => `"${k}"`).join(",")})`;
    try {
      const issues = await searchAllJql(HEBIAR_BASE_URL, jql, ["labels"]);
      for (const is of issues) map.set(is.key, is.fields?.labels || []);
    } catch (err) {
      console.error(
        "Hebiar etiket sorgusu hatası:",
        err.response?.data?.errorMessages || err.message,
      );
    }
  }
  return map;
}

/** Hebiar taskının etiketlerini verilen dizi ile birebir günceller (overwrite). */
async function updateHebiarLabels(key, labels) {
  await axios.put(
    `${HEBIAR_BASE_URL}/rest/api/3/issue/${key}`,
    { fields: { labels } },
    { headers: authHeader(), timeout: REQ_TIMEOUT },
  );
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

/** 429 / 5xx durumunda geri çekilerek yeniden dener. */
async function withRetry(fn, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 || (status >= 500 && status < 600)) {
        const wait = (i + 1) * 1500;
        await new Promise((r) => setTimeout(r, wait));
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function mapWithConcurrency(items, limit, fn) {
  let idx = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (idx < items.length) {
        const cur = idx++;
        await fn(items[cur], cur);
      }
    },
  );
  await Promise.all(workers);
}

async function main() {
  console.log("🔗 Olka → Hebiar etiket eşitleme (Hebiar = Olka birebir kopya)");
  console.log(`   Olka:   ${OLKA_BASE_URL}  (${OLKA_PROJECT_QUERY})`);
  console.log(`   Hebiar: ${HEBIAR_BASE_URL}`);
  if (DRY_RUN) console.log("   ⚠️  DRY-RUN: hiçbir yazma yapılmayacak.");
  console.log("");

  const cllinkFieldId = await getCllinkFieldId();
  if (!cllinkFieldId) {
    console.error("❌ CLLINK alanı bulunamadı; eşleştirme yapılamıyor.");
    process.exit(1);
  }

  // 1) Tüm Olka tasklarını (etiket + CLLINK) çek
  const olkaFields = ["summary", "labels", cllinkFieldId];
  let olkaIssues;
  try {
    olkaIssues = await searchAllJql(
      OLKA_BASE_URL,
      `project = "${OLKA_PROJECT_QUERY}" ORDER BY key ASC`,
      olkaFields,
    );
  } catch (err) {
    console.warn(
      "Proje adı ile sorgu başarısız, proje anahtarı ile deneniyor:",
      err.response?.data?.errorMessages || err.message,
    );
    olkaIssues = await searchAllJql(
      OLKA_BASE_URL,
      `project = ${OLKA_PROJECT_KEY} ORDER BY key ASC`,
      olkaFields,
    );
  }
  console.log(`📥 Olka task sayısı: ${olkaIssues.length}`);

  // 2) CLLINK'e göre Hebiar anahtarına eşle; aynı CL key'e birden çok Olka
  //    taskı bağlıysa etiketleri birleştir (union) -> tek Hebiar hedefi.
  const byClKey = new Map();
  let noLinkCount = 0;
  for (const issue of olkaIssues) {
    const f = issue.fields || {};
    const clKey = extractClKey(f[cllinkFieldId]);
    if (!clKey) {
      noLinkCount++;
      continue;
    }
    if (!byClKey.has(clKey)) {
      byClKey.set(clKey, { clKey, olkaKeys: [], labels: new Set() });
    }
    const g = byClKey.get(clKey);
    g.olkaKeys.push(issue.key);
    for (const l of f.labels || []) g.labels.add(l);
  }
  const groups = [...byClKey.values()];
  console.log(
    `🔗 CLLINK ile eşleşen benzersiz Hebiar taskı: ${groups.length}` +
      `  (CLLINK'i olmayan Olka taskı atlandı: ${noLinkCount})`,
  );

  // 3) Hebiar mevcut etiketlerini çek
  const hebiarLabels = await fetchHebiarLabels(groups.map((g) => g.clKey));

  // 4) Değişiklikleri hesapla
  const toUpdate = [];
  const notFound = [];
  let unchanged = 0;
  for (const g of groups) {
    if (!hebiarLabels.has(g.clKey)) {
      notFound.push(g);
      continue;
    }
    const current = hebiarLabels.get(g.clKey);
    const target = [...g.labels];
    if (sameSet(current, target)) {
      unchanged++;
      continue;
    }
    const added = target.filter((l) => !current.includes(l));
    const removed = current.filter((l) => !target.includes(l));
    toUpdate.push({ ...g, current, target, added, removed });
  }

  console.log("");
  console.log(`📊 Plan:`);
  console.log(`   Zaten eşit (değişmeyecek): ${unchanged}`);
  console.log(`   Güncellenecek Hebiar taskı: ${toUpdate.length}`);
  console.log(
    `   Hebiar'da bulunamadı (silinmiş/erişilemez): ${notFound.length}`,
  );
  console.log("");

  // 5) Uygula
  let ok = 0;
  let fail = 0;
  let totalAdded = 0;
  let totalRemoved = 0;

  await mapWithConcurrency(toUpdate, CONCURRENCY, async (u) => {
    const tag =
      `${u.clKey} (Olka: ${u.olkaKeys.join(", ")})` +
      (u.added.length ? `  +[${u.added.join(", ")}]` : "") +
      (u.removed.length ? `  -[${u.removed.join(", ")}]` : "");
    if (DRY_RUN) {
      console.log(`   • [DRY] ${tag}`);
      totalAdded += u.added.length;
      totalRemoved += u.removed.length;
      ok++;
      return;
    }
    try {
      await withRetry(() => updateHebiarLabels(u.clKey, u.target));
      totalAdded += u.added.length;
      totalRemoved += u.removed.length;
      ok++;
      console.log(`   ✔ ${tag}`);
    } catch (err) {
      fail++;
      console.error(
        `   ✖ ${u.clKey} güncellenemedi:`,
        err.response?.data?.errors ||
          err.response?.data?.errorMessages ||
          err.message,
      );
    }
  });

  console.log("");
  console.log("=".repeat(60));
  console.log(`✅ Tamamlandı${DRY_RUN ? " (DRY-RUN)" : ""}`);
  console.log(`   Güncellenen task: ${ok}`);
  console.log(`   Başarısız: ${fail}`);
  console.log(`   Toplam eklenen etiket: ${totalAdded}`);
  console.log(`   Toplam silinen etiket: ${totalRemoved}`);
  console.log(`   Zaten eşit: ${unchanged}`);
  console.log(`   CLLINK yok (atlanan Olka): ${noLinkCount}`);
  console.log(`   Hebiar'da bulunamayan: ${notFound.length}`);
  if (notFound.length) {
    console.log(
      `      ${notFound
        .map((g) => g.clKey)
        .slice(0, 30)
        .join(", ")}` + (notFound.length > 30 ? " …" : ""),
    );
  }
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\n❌ Beklenmeyen hata:", err.response?.data || err.message);
  process.exit(1);
});
