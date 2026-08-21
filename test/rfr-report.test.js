import assert from "node:assert/strict";
import test from "node:test";
import { RfrReportService } from "../src/lib/rfr-report.js";

test("RFR report queries only active tenant projects", async () => {
  const service = new RfrReportService();
  let capturedJql = "";
  service._searchAllJql = async (jql) => {
    capturedJql = jql;
    return [
      {
        key: "HDV-12",
        fields: {
          project: { key: "HDV", name: "HDV Projesi" },
          summary: "Ready task",
          status: { name: "Ready For Release" },
          assignee: { displayName: "Test User" },
          created: "2026-08-01T00:00:00.000Z",
        },
      },
    ];
  };
  service._fetchIssueChangelog = async () => [];

  const report = await service.getRfrTasks(["KFC", "HDV", "HDV"]);

  assert.match(capturedJql, /project in \("HDV", "KFC"\)/);
  assert.equal(report.count, 1);
  assert.equal(report.rows[0].projectKey, "HDV");
  assert.deepEqual(
    report.projects.map((project) => project.key).sort(),
    ["HDV", "KFC"],
  );
});

test("RFR report skips Jira calls when tenant has no projects", async () => {
  const service = new RfrReportService();
  service._searchAllJql = async () => {
    throw new Error("Jira should not be queried");
  };

  const report = await service.getRfrTasks([]);

  assert.equal(report.count, 0);
  assert.deepEqual(report.projects, []);
  assert.deepEqual(report.rows, []);
});
