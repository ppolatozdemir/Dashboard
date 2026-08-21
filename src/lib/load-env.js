// Minimal .env yükleyici (harici bağımlılık yok).
// Proje kökündeki .env dosyasını okuyup, süreç ortamında HENÜZ tanımlı
// olmayan değişkenleri process.env'e ekler. Böylece Notification servis
// tokenı gibi değerler, sunucu başlatılmadan önce güvenilir şekilde yüklenir.
import fs from "fs";
import path from "path";

function loadEnvFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));
