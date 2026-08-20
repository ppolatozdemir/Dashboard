import { isConfigured } from "../../lib/config.js";

export function requireConfiguration(res) {
  if (isConfigured()) return true;
  res.status(400).json({ error: "Jira yapılandırması eksik" });
  return false;
}

export function sendXlsx(res, buffer, filename) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );
  res.send(buffer);
}

export function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function validateRows(res, rows, message = "Geçersiz veri: rows listesi gerekli") {
  if (Array.isArray(rows)) return true;
  res.status(400).json({ error: message });
  return false;
}
