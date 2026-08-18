import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getConfig } from "./src/lib/config.js";

/**
 * HDV (HDHOLDING) — Hebiar Jira'sındaki TÜM AÇIK taskları backend/app/kiosk/web
 * alanlarına ayırarak tek sayfalık, alanına göre gruplu bir Excel (.xlsx) üretir.
 *
 * Kategorizasyon (kullanıcı onayı ile "issue type + başlık analizi"):
 *   - Issue type App   -> app
 *   - Issue type Kiosk -> kiosk
 *   - Issue type Web   -> web
 *   - Issue type Görev (ve diğer genel tipler) -> başlıkta geçen platform anahtar
 *     kelimesine göre: yalnızca TEK platform (app/web/kiosk) geçiyorsa o alana,
 *     hiç geçmiyorsa VEYA birden fazla platform geçiyorsa (kesişen/sunucu işi) -> backend.
 *
 * Açık task tanımı: statusCategory != Done (REJECT dahil TÜM açık statüler — kullanıcı onayı).
 *
 * Her satır: Alan | Task Kodu | Task Özeti | Statü | Atanan Kişi | Reporter
 *
 * Kullanım:
 *   node hdv-open-tasks-report.js [cikti.xlsx]
 * Ortam değişkenleri: HEBIAR_BASE_URL, HDV_PROJECT
 */

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const PROJECT = process.env.HDV_PROJECT || "HDV";
const REQ_TIMEOUT = Number(process.env.HDV_TIMEOUT_MS || 30000);

// Alan sırası (kullanıcının listelediği sıra): backend, app, kiosk, web
const AREA_ORDER = ["backend", "app", "kiosk", "web"];
const AREA_LABEL = {
  backend: "BACKEND",
  app: "APP",
  kiosk: "KIOSK",
  web: "WEB",
};
// Alan bazlı bant renkleri (koyu dolgu / açık zebra)
const AREA_COLOR = {
  backend: { band: "FF334155", light: "FFEDF1F6" },
  app: { band: "FF2E5AAC", light: "FFEAF0FA" },
  kiosk: { band: "FF7C3AED", light: "FFF1EBFC" },
  web: { band: "FF0F766E", light: "FFE7F4F1" },
};

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

/** Enhanced JQL endpoint'i ile bir sorgunun TÜM sonuçlarını (sayfalı) çeker. */
async function searchAllJql(jql, fields) {
  const headers = authHeader();
  let nextPageToken = null;
  let pages = 0;
  const all = [];
  do {
    const params = { jql, fields: fields.join(","), maxResults: 100 };
    if (nextPageToken) params.nextPageToken = nextPageToken;
    const res = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/search/jql`, {
      params,
      headers,
      timeout: REQ_TIMEOUT,
    });
    all.push(...(res.data.issues || []));
    nextPageToken = res.data.isLast ? null : res.data.nextPageToken || null;
    pages++;
  } while (nextPageToken && pages < 50);
  return all;
}

/** Bir taskı alanına (backend/app/kiosk/web) atar. */
function categorize(issueType, summary) {
  const t = (issueType || "").toLowerCase();
  if (t === "app") return "app";
  if (t === "kiosk") return "kiosk";
  if (t === "web") return "web";
  // Görev / Epik / Subtask vb. genel tipler: başlığa bak.
  const s = summary || "";
  const platforms = [];
  if (/\bapp\b/i.test(s)) platforms.push("app");
  if (/\bweb\b/i.test(s)) platforms.push("web");
  if (/\bkiosk\b/i.test(s)) platforms.push("kiosk");
  // Yalnızca tek platform geçiyorsa o alan; yoksa/birden fazlaysa backend.
  if (platforms.length === 1) return platforms[0];
  return "backend";
}

/** "HDV-371" -> 371 (sayısal sıralama için). */
function keyNum(key) {
  const m = (key || "").match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

async function buildWorkbook(rowsByArea, meta) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PolatAi Dashboard";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("HDV Açık Tasklar", {
    views: [{ state: "frozen", ySplit: 3 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  const columns = [
    { header: "Alan", key: "area", width: 12 },
    { header: "Task Kodu", key: "key", width: 14 },
    { header: "Task Özeti", key: "summary", width: 70 },
    { header: "Statü", key: "status", width: 18 },
    { header: "Atanan Kişi", key: "assignee", width: 24 },
    { header: "Reporter", key: "reporter", width: 24 },
  ];
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));

  const COL_COUNT = columns.length;
  const LAST_COL = "F";
  const NAVY = "FF1F3A5F";
  const HEADER = "FF2E5AAC";
  const BORDER = "FFD5DDE8";
  const REJECT_FILL = "FFFCE4E6";
  const REJECT_TEXT = "FFC0182B";

  // 1. satır: Başlık
  ws.mergeCells(`A1:${LAST_COL}1`);
  const titleCell = ws.getCell("A1");
  titleCell.value = "HDV (HDHOLDING) — Açık Tasklar (Alana Göre Gruplu)";
  titleCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  ws.getRow(1).height = 30;

  // 2. satır: Özet + tarih
  ws.mergeCells(`A2:${LAST_COL}2`);
  const statsCell = ws.getCell("A2");
  const perArea = AREA_ORDER.map(
    (a) => `${AREA_LABEL[a]}: ${(rowsByArea[a] || []).length}`,
  ).join("   |   ");
  statsCell.value = `Toplam açık task: ${meta.total}      |      ${perArea}      |      Oluşturulma: ${new Date().toLocaleString("tr-TR")}`;
  statsCell.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
  statsCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  statsCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF0FA" } };
  ws.getRow(2).height = 18;

  // 3. satır: Kolon başlıkları
  const headerRow = ws.getRow(3);
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER } },
      left: { style: "thin", color: { argb: BORDER } },
      bottom: { style: "medium", color: { argb: NAVY } },
      right: { style: "thin", color: { argb: BORDER } },
    };
  });
  headerRow.height = 22;

  // Veri: her alan için önce bir renkli bant, sonra o alanın taskları
  let rowIdx = 4;
  for (const area of AREA_ORDER) {
    const rows = rowsByArea[area] || [];
    const colors = AREA_COLOR[area];

    // Alan bandı (tüm kolonları kapla)
    ws.mergeCells(`A${rowIdx}:${LAST_COL}${rowIdx}`);
    const band = ws.getCell(`A${rowIdx}`);
    band.value = `▸ ${AREA_LABEL[area]}  (${rows.length} task)`;
    band.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    band.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.band } };
    ws.getRow(rowIdx).height = 22;
    rowIdx++;

    if (rows.length === 0) {
      ws.mergeCells(`A${rowIdx}:${LAST_COL}${rowIdx}`);
      const empty = ws.getCell(`A${rowIdx}`);
      empty.value = "(bu alanda açık task yok)";
      empty.font = { italic: true, color: { argb: "FFAAAAAA" } };
      empty.alignment = { vertical: "middle", horizontal: "left", indent: 2 };
      rowIdx++;
      continue;
    }

    rows.forEach((r, i) => {
      const row = ws.getRow(rowIdx);
      const zebra = i % 2 === 1;
      const isReject = (r.status || "").toUpperCase() === "REJECT";

      row.getCell(1).value = AREA_LABEL[area];

      const c2 = row.getCell(2);
      c2.value = { text: r.key, hyperlink: `${HEBIAR_BASE_URL}/browse/${r.key}` };
      c2.font = { color: { argb: "FF1155CC" }, underline: true, bold: true };

      row.getCell(3).value = r.summary || "";

      const c4 = row.getCell(4);
      c4.value = r.status || "";
      if (isReject) c4.font = { bold: true, color: { argb: REJECT_TEXT } };

      const c5 = row.getCell(5);
      c5.value = r.assignee || "Atanmamış";
      if (!r.assignee) c5.font = { italic: true, color: { argb: "FFAAAAAA" } };

      row.getCell(6).value = r.reporter || "";

      for (let col = 1; col <= COL_COUNT; col++) {
        const cell = row.getCell(col);
        cell.border = {
          top: { style: "hair", color: { argb: BORDER } },
          left: { style: "hair", color: { argb: BORDER } },
          bottom: { style: "hair", color: { argb: BORDER } },
          right: { style: "hair", color: { argb: BORDER } },
        };
        cell.alignment = {
          vertical: "middle",
          horizontal: col === 3 ? "left" : col === 1 ? "center" : "left",
          wrapText: col === 3,
        };
        if (isReject) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: REJECT_FILL } };
        } else if (zebra) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.light } };
        }
      }
      rowIdx++;
    });
  }

  // Başlık satırına otomatik filtre
  ws.autoFilter = { from: "A3", to: `${LAST_COL}3` };

  return workbook;
}

async function main() {
  const outArg = process.argv[2];
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = outArg
    ? path.resolve(outArg)
    : path.join(__dirname, `HDV-Acik-Tasklar-${stamp}.xlsx`);

  console.log("HDV açık tasklar çekiliyor...", HEBIAR_BASE_URL, PROJECT);
  const jql = `project = "${PROJECT}" AND statusCategory != Done ORDER BY key DESC`;
  const issues = await searchAllJql(jql, [
    "summary",
    "status",
    "assignee",
    "reporter",
    "issuetype",
  ]);
  console.log(`Toplam açık task: ${issues.length}`);

  const rowsByArea = { backend: [], app: [], kiosk: [], web: [] };
  for (const is of issues) {
    const f = is.fields || {};
    const area = categorize(f.issuetype?.name, f.summary);
    rowsByArea[area].push({
      key: is.key,
      summary: f.summary || "",
      status: f.status?.name || "",
      assignee: f.assignee?.displayName || "",
      reporter: f.reporter?.displayName || "",
      issueType: f.issuetype?.name || "",
    });
  }

  // Her alan içinde task koduna göre azalan (en yeni önce) sırala
  for (const a of AREA_ORDER) {
    rowsByArea[a].sort((x, y) => keyNum(y.key) - keyNum(x.key));
    console.log(`  ${AREA_LABEL[a]}: ${rowsByArea[a].length} task`);
  }

  const workbook = await buildWorkbook(rowsByArea, { total: issues.length });
  await workbook.xlsx.writeFile(outPath);
  console.log(`\nExcel oluşturuldu: ${outPath}`);
}

main().catch((e) => {
  console.error("HATA:", e.response?.data?.errorMessages || e.stack || e.message);
  process.exit(1);
});
