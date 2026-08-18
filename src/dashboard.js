#!/usr/bin/env node

import dashboardServer from "./lib/dashboard-server.js";
import { isConfigured } from "./lib/config.js";

const port = process.env.PORT || 3002;

// Beklenmeyen hatalarda sunucu çökmesin; hatayı logla ve çalışmaya devam et.
process.on("uncaughtException", (error) => {
  console.error(
    "⚠️ Beklenmeyen hata (yakalandı, sunucu çalışmaya devam ediyor):",
    error,
  );
});

process.on("unhandledRejection", (reason) => {
  console.error(
    "⚠️ İşlenmeyen promise reddi (yakalandı, sunucu çalışmaya devam ediyor):",
    reason,
  );
});

async function start() {
  console.log("\n🚀 Jira Support Dashboard başlatılıyor...\n");

  if (!isConfigured()) {
    console.error("❌ Jira yapılandırması eksik!");
    console.error('Önce "jira config" komutunu çalıştırın.\n');
    process.exit(1);
  }

  try {
    await dashboardServer.start(port);
  } catch (error) {
    console.error("❌ Dashboard başlatılamadı:", error.message);
    process.exit(1);
  }
}

start();
