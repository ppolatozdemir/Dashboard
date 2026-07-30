// Preprod vs Test ürün fiyat karşılaştırması.
// Kullanım:
//   node compare-product-prices.js "<preprod.xlsx>" "<test.xlsx>" ["<cikti.xlsx>"]
// ProductCode (Ürün Kodu) iş anahtarı olarak kullanılır; ProductId/ProductPriceId
// ortama özel sayısal ID'ler olduğu için karşılaştırmada kullanılmaz.

import fs from "fs";
import path from "path";
import JSZip from "jszip";
import ExcelJS from "exceljs";

const [preprodPath, testPath, outArg] = process.argv.slice(2);
if (!preprodPath || !testPath) {
  console.error(
    'Kullanım: node compare-product-prices.js "<preprod.xlsx>" "<test.xlsx>" ["<cikti.xlsx>"]',
  );
  process.exit(1);
}
const outPath =
  outArg ||
  path.join(
    path.dirname(preprodPath),
    "Preprodda_Olup_Testte_Olmayan_Urunler.xlsx",
  );

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
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&amp;/g, "&");
}

async function parseWorkbook(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const ssXml = await zip.file("xl/sharedStrings.xml").async("string");
  const shared = [];
  const siRe = /<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g;
  let m;
  while ((m = siRe.exec(ssXml))) {
    const tRe = /<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
    let t,
      text = "";
    while ((t = tRe.exec(m[1]))) text += t[1];
    shared.push(decodeXml(text));
  }
  const sheetXml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const rows = [];
  const rowRe = /<(?:\w+:)?row[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rm;
  while ((rm = rowRe.exec(sheetXml))) {
    const cellRe = /<(?:\w+:)?c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
    let cm;
    const cells = [];
    while ((cm = cellRe.exec(rm[1]))) {
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
  const header = rows[0].map((h) => (h || "").trim());
  const dataRows = rows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = cells[i] !== undefined ? cells[i] : "";
    });
    return obj;
  });
  return { header, rows: dataRows };
}

const norm = (v) => (v == null ? "" : String(v)).trim().toUpperCase();

const pre = await parseWorkbook(preprodPath);
const test = await parseWorkbook(testPath);

const testCodeSet = new Set(test.rows.map((r) => norm(r.ProductCode)));
const missingRows = pre.rows.filter(
  (r) => !testCodeSet.has(norm(r.ProductCode)),
);

const uniqueMap = new Map();
for (const r of missingRows) {
  const key = norm(r.ProductCode);
  if (!uniqueMap.has(key)) {
    uniqueMap.set(key, {
      ProductCode: r.ProductCode,
      ProductName: r.ProductName,
      Barcode: r.Barcode,
      FiyatSatirSayisi: 1,
    });
  } else {
    uniqueMap.get(key).FiyatSatirSayisi++;
  }
}
const uniqueMissing = [...uniqueMap.values()].sort((a, b) =>
  a.ProductCode.localeCompare(b.ProductCode, "tr"),
);

const wb = new ExcelJS.Workbook();
wb.creator = "PolatAi";
wb.created = new Date();
const headerStyle = {
  font: { bold: true, color: { argb: "FFFFFFFF" } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } },
  alignment: { vertical: "middle", horizontal: "left" },
};

const s1 = wb.addWorksheet("Eksik Ürünler");
s1.columns = [
  { header: "Ürün Kodu", key: "ProductCode", width: 22 },
  { header: "Ürün Adı", key: "ProductName", width: 40 },
  { header: "Barkod", key: "Barcode", width: 40 },
  { header: "Preprod Fiyat Satır Sayısı", key: "FiyatSatirSayisi", width: 26 },
];
uniqueMissing.forEach((p) => s1.addRow(p));
s1.getRow(1).eachCell((c) => Object.assign(c, headerStyle));
s1.autoFilter = "A1:D1";
s1.views = [{ state: "frozen", ySplit: 1 }];

const s2 = wb.addWorksheet("Detay - Tüm Fiyat Satırları");
s2.columns = pre.header.map((h) => ({
  header: h,
  key: h,
  width: Math.max(14, Math.min(42, h.length + 6)),
}));
missingRows.forEach((r) => s2.addRow(r));
s2.getRow(1).eachCell((c) => Object.assign(c, headerStyle));
s2.views = [{ state: "frozen", ySplit: 1 }];

const s3 = wb.addWorksheet("Özet");
s3.columns = [{ width: 42 }, { width: 40 }];
const summary = [
  ["Preprod kaynak dosya", path.basename(preprodPath)],
  ["Test kaynak dosya", path.basename(testPath)],
  ["Karşılaştırma anahtarı", "ProductCode (Ürün Kodu)"],
  ["", ""],
  ["Preprod fiyat satırı", pre.rows.length],
  ["Test fiyat satırı", test.rows.length],
  [
    "Preprod benzersiz ürün",
    new Set(pre.rows.map((r) => norm(r.ProductCode))).size,
  ],
  ["Test benzersiz ürün", testCodeSet.size],
  ["Preprodda olup Testte OLMAYAN ürün", uniqueMissing.length],
  ["Bu ürünlere ait Preprod fiyat satırı", missingRows.length],
];
summary.forEach((row) => s3.addRow(row));
s3.getRow(1).eachCell((c) => Object.assign(c, headerStyle));

await wb.xlsx.writeFile(outPath);

console.log(
  "Preprod:",
  path.basename(preprodPath),
  "->",
  pre.rows.length,
  "satır",
);
console.log(
  "Test   :",
  path.basename(testPath),
  "->",
  test.rows.length,
  "satır",
);
console.log(
  "Preprodda olup Testte olmayan benzersiz ürün:",
  uniqueMissing.length,
);
console.log("Çıktı:", outPath);
console.log("\n--- Eksik ürünler ---");
uniqueMissing.forEach((p, i) => {
  console.log(
    `${String(i + 1).padStart(3)}. ${p.ProductCode}  |  ${p.ProductName}`,
  );
});
