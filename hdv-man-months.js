import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getConfig } from "./src/lib/config.js";

/**
 * HDV (HDHOLDING) — ADAM/AY kullanım hesabı (faturalama için).
 *
 * Yöntem (kullanıcı onayı):
 *   - Üyelik süresi: her kişinin projeye EKLENDİĞİ tarihten BUGÜNE (aktifse) ya da
 *     ÇIKARILDIĞI tarihe (ayrıldıysa) kadar geçen süre.
 *   - Kapsam: projeye eklenen HERKES (aktif + ayrılanlar). Uygulama/eklenti hesapları hariç.
 *   - 1 adam/ay = 20 İŞ GÜNÜ (Pzt–Cum). Süre içindeki iş günleri sayılır / 20.
 *
 * Tarih kaynağı: audit log "Project roles changed" (Member/Üye) changedFrom→changedTo.
 *   - Ekleme: kişinin ilk göründüğü kayıt (from'da ise audit penceresi öncesi → başlangıç = en erken audit tarihi, ALT SINIR).
 *   - Çıkış: kişinin üye listesinden (changedTo) düştüğü kayıt.
 *
 * Çıktı: hdv-man-months.log (UTF-8). Env: AS_OF (bitiş tarihi, vars. bugün), MM_WORKDAYS (vars. 20).
 */

const LOG_FILE = "hdv-man-months.log";
try {
  fs.writeFileSync(LOG_FILE, "");
} catch {}
function log(...args) {
  const line =
    args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2)))
      .join(" ") + "\n";
  try {
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch {}
  process.stdout.write(line);
}

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const PROJECT = process.env.HDV_PROJECT || "HDV";
const MEMBER_ROLE_NAMES = new Set(["Member", "Üye"]);
const WORKDAYS_PER_MM = Number(process.env.MM_WORKDAYS || 20);
const AS_OF = process.env.AS_OF ? new Date(process.env.AS_OF) : new Date();

function authHeader() {
  const { email, apiToken } = getConfig();
  if (!email || !apiToken) throw new Error("Jira kimlik bilgileri eksik.");
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

const parseIds = (str) =>
  !str
    ? []
    : str
        .split(/\s*,\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
const dOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fmt = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// İki tarih arası (dahil) iş günü (Pzt–Cum) sayısı
function businessDays(start, end) {
  let s = dOnly(start),
    e = dOnly(end);
  if (e < s) return 0;
  let count = 0;
  for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) count++;
  }
  return count;
}

async function mapWithConcurrency(items, limit, fn) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

// Stilli .xlsx üretir (exceljs). rows: {name,active,pre,start,end,days,mm}
async function buildManMonthsWorkbook(rows, meta) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PolatAi Dashboard";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("HDV Adam-Ay", {
    views: [{ state: "frozen", ySplit: 3 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  const columns = [
    { header: "#", width: 5 },
    { header: "Kullanıcı", width: 26 },
    { header: "Durum", width: 10 },
    { header: "Eklenme", width: 14 },
    { header: "Bitiş", width: 14 },
    { header: "İş Günü", width: 10 },
    { header: "Adam/Ay", width: 10 },
    { header: "Not", width: 40 },
  ];
  ws.columns = columns.map((c) => ({ width: c.width }));

  const COL_COUNT = columns.length;
  const LAST_COL = "H";
  const NAVY = "FF1F3A5F";
  const HEADER = "FF2E5AAC";
  const BORDER = "FFD5DDE8";
  const ZEBRA = "FFEAF0FA";
  const LEFT_FILL = "FFFCE4E6"; // ayrılanlar
  const LEFT_TEXT = "FFC0182B";
  const TOTAL_FILL = "FF16324F";

  // 1) Başlık
  ws.mergeCells(`A1:${LAST_COL}1`);
  const t = ws.getCell("A1");
  t.value = `${meta.projName} — Adam/Ay Kullanım Raporu`;
  t.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  ws.getRow(1).height = 30;

  // 2) Özet
  ws.mergeCells(`A2:${LAST_COL}2`);
  const s = ws.getCell("A2");
  s.value = `Yöntem: üyelik süresi  |  1 adam/ay = ${meta.workdays} iş günü (Pzt–Cum)  |  Dönem: ${fmt(meta.auditStart)} → ${fmt(meta.asOf)}  |  TOPLAM ≈ ${meta.totalMM.toFixed(2)} adam/ay  |  Oluşturulma: ${new Date().toLocaleString("tr-TR")}`;
  s.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
  s.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
  ws.getRow(2).height = 18;

  // 3) Kolon başlıkları
  const headerRow = ws.getRow(3);
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER } };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER } },
      left: { style: "thin", color: { argb: BORDER } },
      bottom: { style: "medium", color: { argb: NAVY } },
      right: { style: "thin", color: { argb: BORDER } },
    };
  });
  headerRow.height = 20;

  const noteFor = (r) => {
    const parts = [];
    if (r.pre) parts.push("audit öncesi — başlangıç alt sınır");
    if (!r.active) parts.push("çıkış audit'ten türetildi");
    if (/^(core|id)$/i.test(r.name)) parts.push("servis/genel hesap");
    if (/^tahir/i.test(r.name)) parts.push("proje lideri (Administrator)");
    return parts.join("; ");
  };

  // 4) Veri satırları
  let rowIdx = 4;
  rows.forEach((r, i) => {
    const row = ws.getRow(rowIdx);
    const zebra = i % 2 === 1;

    row.getCell(1).value = i + 1;
    row.getCell(2).value = r.name;
    row.getCell(3).value = r.active ? "aktif" : "AYRILDI";
    const cStart = row.getCell(4);
    cStart.value = dOnly(r.start);
    cStart.numFmt = "yyyy-mm-dd";
    const cEnd = row.getCell(5);
    cEnd.value = dOnly(r.end);
    cEnd.numFmt = "yyyy-mm-dd";
    row.getCell(6).value = r.days;
    const cMM = row.getCell(7);
    cMM.value = r.mm;
    cMM.numFmt = "0.00";
    row.getCell(8).value = noteFor(r);

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
        horizontal: col === 2 || col === 8 ? "left" : "center",
        wrapText: col === 8,
      };
      if (!r.active) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: LEFT_FILL },
        };
      } else if (zebra) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: ZEBRA },
        };
      }
    }
    if (!r.active)
      row.getCell(3).font = { bold: true, color: { argb: LEFT_TEXT } };
    row.height = 18;
    rowIdx++;
  });

  // 5) TOPLAM satırı
  ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
  const tl = ws.getCell(`A${rowIdx}`);
  tl.value = `TOPLAM — ${rows.length} kişi (aktif ${rows.filter((r) => r.active).length}, ayrılan ${rows.filter((r) => !r.active).length})`;
  tl.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  tl.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
  const cd = ws.getCell(`F${rowIdx}`);
  cd.value = meta.totalDays;
  cd.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  cd.alignment = { vertical: "middle", horizontal: "center" };
  const cm = ws.getCell(`G${rowIdx}`);
  cm.value = meta.totalMM;
  cm.numFmt = "0.00";
  cm.font = { bold: true, size: 12, color: { argb: "FFFFE08A" } };
  cm.alignment = { vertical: "middle", horizontal: "center" };
  const ch = ws.getCell(`H${rowIdx}`);
  ch.value = "adam/ay";
  ch.font = { bold: true, italic: true, color: { argb: "FFFFFFFF" } };
  ch.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  for (let col = 1; col <= COL_COUNT; col++) {
    ws.getCell(rowIdx, col).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: TOTAL_FILL },
    };
  }
  ws.getRow(rowIdx).height = 24;
  rowIdx += 2;

  // 6) Notlar
  const notes = [
    `Not 1: '≤' başlangıçlı kişiler (audit öncesi eklenmiş) için başlangıç ${fmt(meta.auditStart)} alınmıştır — ALT SINIR, gerçek süre daha uzun olabilir.`,
    "Not 2: Ayrılanların çıkış tarihi audit rol geçişinden türetilmiştir.",
    `Not 3: Sadece hafta sonları düşülmüştür; resmî tatiller HARİÇ DEĞİLDİR. Kapsam: projeye eklenen herkes (lider + servis hesapları dahil). 1 adam/ay = ${meta.workdays} iş günü.`,
  ];
  for (const n of notes) {
    ws.mergeCells(`A${rowIdx}:${LAST_COL}${rowIdx}`);
    const nc = ws.getCell(`A${rowIdx}`);
    nc.value = n;
    nc.font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
    nc.alignment = {
      vertical: "middle",
      horizontal: "left",
      indent: 1,
      wrapText: true,
    };
    rowIdx++;
  }

  ws.autoFilter = { from: "A3", to: `${LAST_COL}3` };
  return workbook;
}

async function main() {
  log("=== HDV (HDHOLDING) ADAM/AY KULLANIM HESABI ===");
  log(
    `Yöntem: üyelik süresi | 1 adam/ay = ${WORKDAYS_PER_MM} iş günü | Bitiş (AS_OF): ${fmt(AS_OF)}\n`,
  );

  // 1) Mevcut insan üyeler (Member + Administrator) + isimler
  const nameById = new Map();
  const currentMemberIds = new Set();
  let projName = "HDHOLDING";
  try {
    const proj = await axios.get(
      `${HEBIAR_BASE_URL}/rest/api/3/project/${PROJECT}`,
      { headers: authHeader(), timeout: 30000 },
    );
    projName = proj.data.name;
  } catch {}
  try {
    const rolesRes = await axios.get(
      `${HEBIAR_BASE_URL}/rest/api/3/project/${PROJECT}/role`,
      { headers: authHeader(), timeout: 30000 },
    );
    for (const [roleName, roleUrl] of Object.entries(rolesRes.data || {})) {
      // Sadece insan rolleri; uygulama/eklenti erişimini atla
      if (!MEMBER_ROLE_NAMES.has(roleName) && roleName !== "Administrator")
        continue;
      try {
        const rd = await axios.get(roleUrl, {
          headers: authHeader(),
          timeout: 30000,
        });
        for (const a of rd.data.actors || []) {
          if (a.type === "atlassian-user-role-actor" || a.actorUser) {
            const id = a.actorUser?.accountId || a.id;
            nameById.set(id, a.displayName);
            currentMemberIds.add(id);
          }
        }
      } catch {}
    }
  } catch (e) {
    log("Rol listesi hatası:", e.response?.status, e.message);
  }

  // 2) Tüm audit kayıtları
  const records = [];
  try {
    let offset = 0;
    const limit = 1000;
    for (let page = 0; page < 25; page++) {
      const res = await axios.get(
        `${HEBIAR_BASE_URL}/rest/api/3/auditing/record`,
        { params: { offset, limit }, headers: authHeader(), timeout: 60000 },
      );
      const recs = res.data.records || [];
      records.push(...recs);
      const total = res.data.total ?? recs.length;
      offset += limit;
      if (offset >= total || recs.length === 0) break;
    }
  } catch (e) {
    log(
      "Audit erişim hatası:",
      e.response?.status,
      JSON.stringify(e.response?.data?.errorMessages || e.message),
    );
    return;
  }

  const projMatches = (r) =>
    [r.objectItem, ...(r.associatedItems || [])]
      .filter(Boolean)
      .some(
        (it) =>
          it.typeName === "PROJECT" &&
          (it.name === projName || it.id === "10457"),
      );
  const roleChanges = records
    .filter(
      (r) =>
        r.summary === "Project roles changed" &&
        r.objectItem?.typeName === "PROJECT_ROLE" &&
        MEMBER_ROLE_NAMES.has(r.objectItem?.name) &&
        projMatches(r),
    )
    .sort((a, b) => new Date(a.created) - new Date(b.created));

  if (!roleChanges.length) {
    log("Member rol değişim kaydı yok.");
    return;
  }
  const AUDIT_START = new Date(roleChanges[0].created); // pre-window üyeler için başlangıç (ALT SINIR)

  // 3) Üyelik zaman çizelgesini yeniden kur (changedTo = o andaki TAM üye listesi)
  const addAt = new Map(); // id -> Date (ekleme; from'da ise AUDIT_START)
  const removeAt = new Map(); // id -> Date (çıkış; yeniden eklenirse silinir)
  const preWindow = new Set(); // audit öncesi zaten üye olanlar
  const usersChange = (r) =>
    (r.changedValues || []).find((c) => c.fieldName === "Users");

  let prevTo = new Set(parseIds(usersChange(roleChanges[0])?.changedFrom));
  for (const id of prevTo) {
    preWindow.add(id);
    addAt.set(id, AUDIT_START);
  }

  for (const r of roleChanges) {
    const uc = usersChange(r);
    if (!uc) continue;
    const toSet = new Set(parseIds(uc.changedTo));
    const when = new Date(r.created);
    // yeni eklenenler
    for (const id of toSet) {
      if (!addAt.has(id)) addAt.set(id, when);
      if (removeAt.has(id)) removeAt.delete(id); // yeniden eklendi
    }
    // çıkarılanlar: önceki listede olup şimdi olmayanlar
    for (const id of prevTo) if (!toSet.has(id)) removeAt.set(id, when);
    prevTo = toSet;
  }

  // Mevcut üye olduğu halde hiç Member kaydı olmayanlar (ör. Tahir = Administrator/lider)
  for (const id of currentMemberIds)
    if (!addAt.has(id)) {
      addAt.set(id, AUDIT_START);
      preWindow.add(id);
    }

  // 4) İsim çözümleme
  const unknown = [...addAt.keys()].filter(
    (id) => !nameById.has(id) && !id.startsWith("ug:"),
  );
  await mapWithConcurrency(unknown, 5, async (id) => {
    try {
      const res = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/user`, {
        params: { accountId: id },
        headers: authHeader(),
        timeout: 20000,
      });
      nameById.set(
        id,
        res.data.displayName + (res.data.active === false ? " (pasif)" : ""),
      );
    } catch {
      nameById.set(id, "(bilinmeyen)");
    }
  });
  const nm = (id) => nameById.get(id) || id;

  // 5) Adam/ay hesapla
  const rows = [...addAt.entries()]
    .map(([id, start]) => {
      const active = currentMemberIds.has(id);
      const end = active ? AS_OF : removeAt.get(id) || AS_OF;
      const days = businessDays(start, end);
      return {
        id,
        name: nm(id),
        active,
        pre: preWindow.has(id),
        start,
        end,
        days,
        mm: days / WORKDAYS_PER_MM,
      };
    })
    .sort((a, b) => a.start - b.start || b.mm - a.mm);

  const totalDays = rows.reduce((s, r) => s + r.days, 0);
  const totalMM = totalDays / WORKDAYS_PER_MM;

  log(
    "Başlangıç          | Bitiş      | İş günü | Adam/Ay | Durum   | Kullanıcı",
  );
  log(
    "-------------------|------------|---------|---------|---------|-------------------------",
  );
  for (const r of rows) {
    const startStr = (r.pre ? "≤" : " ") + fmt(r.start);
    log(
      `${startStr.padEnd(18)} | ${fmt(r.end).padEnd(10)} | ${String(r.days).padStart(7)} | ${r.mm.toFixed(2).padStart(7)} | ${(r.active ? "aktif" : "AYRILDI").padEnd(7)} | ${r.name}`,
    );
  }

  log("\n=== TOPLAM ===");
  log(
    `Kişi sayısı: ${rows.length} (aktif: ${rows.filter((r) => r.active).length}, ayrılan: ${rows.filter((r) => !r.active).length})`,
  );
  log(`Toplam iş günü: ${totalDays}`);
  log(
    `TOPLAM ADAM/AY: ${totalMM.toFixed(2)}  (1 adam/ay = ${WORKDAYS_PER_MM} iş günü)`,
  );
  log(
    `\nNot: '≤' işaretli başlangıçlar audit penceresi (${fmt(AUDIT_START)}) öncesi eklenmiş olup ALT SINIRDIR (gerçek süre daha uzun olabilir).`,
  );

  // 6) Excel çıktısı
  const outArg = process.argv[2];
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outPath = outArg
    ? path.resolve(outArg)
    : path.join(__dirname, `HDV-Adam-Ay-${fmt(AS_OF)}.xlsx`);
  const workbook = await buildManMonthsWorkbook(rows, {
    projName,
    workdays: WORKDAYS_PER_MM,
    auditStart: AUDIT_START,
    asOf: AS_OF,
    totalDays,
    totalMM,
  });
  await workbook.xlsx.writeFile(outPath);
  log(`\nExcel oluşturuldu: ${outPath}`);

  log("\n=== BİTTİ (DONE) ===");
}

main().catch((e) => log("FATAL:", e.stack || e.message));
