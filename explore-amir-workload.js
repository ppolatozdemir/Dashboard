/**
 * Tanı: İş Yükü raporunda Amir Daliri'ye düşen maddeleri (sprint + support)
 * statü/proje kırılımıyla dökümler. Yazma yapmaz.
 *
 * Kullanım: node explore-amir-workload.js
 */
import fs from "fs";
import supportReportService from "./src/lib/support-report.js";

const LOG_FILE = "explore-amir-workload.log";
const lines = [];
const log = (msg) => {
  console.log(msg);
  lines.push(msg);
};

const TARGET = (process.env.TARGET_PERSON || "Amir").toLowerCase();

const excludedStatusLabels = {
  "customer action": "Customer Action",
  "ready for release": "Ready For Release",
  merge: "Merge",
  merged: "Merged",
  "on hold": "On Hold",
  block: "Block",
  "qa testing": "QA Testing",
  test: "Test",
};
const excludedStatuses = Object.keys(excludedStatusLabels);

const svc = supportReportService;

const norm = (i) => (i.fields.status?.name || "").toLowerCase().trim();
const isMine = (i) =>
  (i.fields.assignee?.displayName || "").toLowerCase().includes(TARGET);

function dump(title, issues) {
  log(`\n=== ${title} (${issues.length}) ===`);
  const byStatus = new Map();
  issues.forEach((i) => {
    const s = i.fields.status?.name || "(statüsüz)";
    byStatus.set(s, (byStatus.get(s) || 0) + 1);
  });
  [...byStatus.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([s, c]) => log(`  ${s}: ${c}`));
  log("  ---");
  issues.forEach((i) => {
    log(
      `  ${i.key} | ${i.fields.project?.key} | ${i.fields.status?.name} | ${(
        i.fields.summary || ""
      ).slice(0, 70)}`,
    );
  });
}

async function main() {
  svc.client.init();

  const weeklySprintIds = await svc.getActiveWeeklySprintIds();
  log(`Aktif weekly sprint id'leri: ${JSON.stringify(weeklySprintIds)}`);

  const sprintJql = weeklySprintIds.length
    ? `sprint in (${weeklySprintIds.join(", ")}) AND statusCategory != Done ORDER BY "cf[10020]" DESC`
    : `sprint in openSprints() AND sprint NOT IN futureSprints() AND statusCategory != Done ORDER BY "cf[10020]" DESC`;
  log(`\nSPRINT JQL: ${sprintJql}`);

  const sprintIssues = await svc.searchHebiarJql(
    sprintJql,
    ["summary", "status", "assignee", "project"],
    500,
  );
  const mineSprintRaw = sprintIssues.filter(isMine);
  dump("SPRINT - ham (hariç tutulan statüler dahil)", mineSprintRaw);

  const mineSprintCounted = mineSprintRaw.filter(
    (i) => !excludedStatuses.includes(norm(i)),
  );
  dump("SPRINT - RAPORDA SAYILAN", mineSprintCounted);

  const mineSprintExcluded = mineSprintRaw.filter((i) =>
    excludedStatuses.includes(norm(i)),
  );
  dump("SPRINT - hariç tutulan statüler nedeniyle sayılmayan", mineSprintExcluded);

  const supportJql = `created >= -100d AND status in (Backlog, "Customer Action Required", Escalated, "In Progress", "On Hold", Open, Pending, Reopened, "Request For Development", "Selected For Development", test, Returned, "To Do", Uat, "Waiting for customer", "Waiting for support", "Work in progress") AND "Customer Support[Dropdown]" = Evet ORDER BY assignee ASC, created DESC`;
  const supportIssues = await svc.searchHebiarJql(
    supportJql,
    ["summary", "status", "assignee", "project"],
    2000,
  );
  const mineSupport = supportIssues.filter(isMine);
  dump("SUPPORT - RAPORDA SAYILAN", mineSupport);

  log(
    `\nÖZET: sprint=${mineSprintCounted.length} + support=${mineSupport.length} = toplam ${
      mineSprintCounted.length + mineSupport.length
    }`,
  );
  log("DONE");
  fs.writeFileSync(LOG_FILE, lines.join("\n"), "utf8");
}

main().catch((e) => {
  log(`HATA: ${e.message}`);
  log("DONE");
  fs.writeFileSync(LOG_FILE, lines.join("\n"), "utf8");
});
