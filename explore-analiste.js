// Geçici keşif scripti: xlsx içindeki sheet adlarını listeler ve "Analiste"
// sayfasının başlık + ilk satırlarını döker.
import fs from "fs";
import JSZip from "jszip";

const file =
  process.argv[2] ||
  "C:/Users/Commercelab/Downloads/jira-search-cb05c18e-42ca-4ca9-b961-5762c68379ee.xlsx";

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

const zip = await JSZip.loadAsync(fs.readFileSync(file));

// Shared strings
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

// Sheet name -> r:id
const wbXml = await zip.file("xl/workbook.xml").async("string");
const sheetDefs = [];
const shRe = /<(?:\w+:)?sheet\s+([^>]*?)\/?>/g;
let sm;
while ((sm = shRe.exec(wbXml))) {
  const attrs = sm[1];
  const name = /name="([^"]*)"/.exec(attrs)?.[1];
  const rid = /r:id="([^"]*)"/.exec(attrs)?.[1];
  const sheetId = /sheetId="([^"]*)"/.exec(attrs)?.[1];
  sheetDefs.push({ name: decodeXml(name || ""), rid, sheetId });
}

// r:id -> target file
const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
const relMap = {};
const relRe = /<Relationship\s+([^>]*?)\/?>/g;
let rm;
while ((rm = relRe.exec(relsXml))) {
  const attrs = rm[1];
  const id = /Id="([^"]*)"/.exec(attrs)?.[1];
  const target = /Target="([^"]*)"/.exec(attrs)?.[1];
  if (id && target) relMap[id] = target.replace(/^\/?xl\//, "").replace(/^\//, "");
}

console.log("=== SHEETS ===");
for (const s of sheetDefs) {
  console.log(`name="${s.name}"  rid=${s.rid}  target=${relMap[s.rid]}`);
}

function parseSheet(targetPath) {
  const full = targetPath.startsWith("xl/") ? targetPath : `xl/${targetPath}`;
  const f = zip.file(full);
  if (!f) return null;
  return f.async("string").then((sheetXml) => {
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
  });
}

const analiste =
  sheetDefs.find((s) => s.name.toLowerCase().includes("analiste")) || sheetDefs[0];
console.log(`\n=== DUMP: "${analiste.name}" ===`);
const rows = await parseSheet(relMap[analiste.rid]);
if (!rows) {
  console.log("Sheet dosyası bulunamadı:", relMap[analiste.rid]);
} else {
  const header = rows[0].map((h) => (h || "").trim());
  const iKey = header.indexOf("Anahtar");
  const iAssignee = header.indexOf("Atanan Kişi");
  const iPlatform = header.indexOf("Platform");
  console.log("Toplam veri satırı:", rows.length - 1);
  console.log("Kolon indeksleri -> Anahtar:", iKey, "Atanan:", iAssignee, "Platform:", iPlatform);

  const assignees = new Map();
  const platforms = new Map();
  const emptyAssignee = [];
  const emptyPlatform = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const key = (r[iKey] || "").trim();
    const a = (r[iAssignee] || "").trim();
    const p = (r[iPlatform] || "").trim();
    if (a) assignees.set(a, (assignees.get(a) || 0) + 1);
    else emptyAssignee.push(key);
    if (p) platforms.set(p, (platforms.get(p) || 0) + 1);
    else emptyPlatform.push(key);
  }
  console.log("\n--- Benzersiz ATANAN KİŞİLER (sayı) ---");
  for (const [k, v] of [...assignees.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${JSON.stringify(k)}: ${v}`);
  console.log("Atananı boş olanlar:", emptyAssignee.length, emptyAssignee.join(", "));
  console.log("\n--- Benzersiz PLATFORMLAR (sayı) ---");
  for (const [k, v] of [...platforms.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${JSON.stringify(k)}: ${v}`);
  console.log("Platformu boş olanlar:", emptyPlatform.length, emptyPlatform.join(", "));
}
