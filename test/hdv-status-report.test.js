import assert from "node:assert/strict";
import test from "node:test";
import { HdvStatusReportService } from "../src/lib/hdv-status-report.js";

test("HDV report lists only open tasks assigned to a sprint", async () => {
  const service = new HdvStatusReportService();
  service._fetchAllowedIssues = async () => [
    {
      key: "HDV-10",
      fields: {
        summary: "Sprint task",
        assignee: { displayName: "Gökhan Koçak" },
        reporter: { displayName: "Reporter" },
        status: {
          name: "In Progress",
          statusCategory: { key: "indeterminate" },
        },
        customfield_10020: [{ name: "Sprint 10", state: "active" }],
      },
    },
    {
      key: "HDV-11",
      fields: {
        summary: "Backlog task",
        assignee: { displayName: "Gökhan Koçak" },
        status: {
          name: "To Do",
          statusCategory: { key: "new" },
        },
        customfield_10020: null,
      },
    },
  ];

  const report = await service.getHdvStatusTasks();

  assert.deepEqual(report.rows.map((row) => row.key), ["HDV-10"]);
  assert.equal(report.rows[0].sprint, "Sprint 10");
});
