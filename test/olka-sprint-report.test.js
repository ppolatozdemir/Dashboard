import assert from "node:assert/strict";
import test from "node:test";
import { OlkaSprintReportService } from "../src/lib/olka-sprint-report.js";

test("Sprint statuses use completed, blocked and CustomerAction groups", () => {
  const service = new OlkaSprintReportService();

  assert.equal(service.classifyStatus("Ready For Release", "indeterminate"), "completed");
  assert.equal(service.classifyStatus("Onlive", "done"), "completed");
  assert.equal(service.classifyStatus("On Hold", "indeterminate"), "blocked");
  assert.equal(
    service.classifyStatus("CustomerAction", "indeterminate"),
    "customerAction",
  );
  assert.equal(service.classifyStatus("In Progress", "indeterminate"), "remaining");
});

test("Sprint report includes only active tenant projects", async () => {
  const service = new OlkaSprintReportService();
  service._fetchAllSprints = async () => [
    {
      id: 42,
      name: "Sprint 42",
      state: "closed",
      completeDate: "2026-08-20T12:00:00.000Z",
    },
  ];
  service._fetchAllSprintIssues = async () => [
    {
      key: "MC-2",
      fields: {
        summary: "Completed",
        status: {
          name: "Merged",
          statusCategory: { key: "indeterminate", name: "In Progress" },
        },
      },
    },
    {
      key: "IMC-3",
      fields: {
        summary: "Customer wait",
        status: {
          name: "CustomerAction",
          statusCategory: { key: "indeterminate", name: "In Progress" },
        },
      },
    },
    {
      key: "HDV-9",
      fields: {
        summary: "Other tenant",
        status: {
          name: "In Progress",
          statusCategory: { key: "indeterminate", name: "In Progress" },
        },
      },
    },
  ];

  const report = await service.getSprintReport(null, ["MC", "IMC"]);

  assert.deepEqual(report.rows.map((row) => row.key), ["IMC-3", "MC-2"]);
  assert.equal(report.stats.total, 2);
  assert.equal(report.stats.completed, 1);
  assert.equal(report.stats.blocked, 1);
  assert.equal(report.customerAction.length, 1);
});
