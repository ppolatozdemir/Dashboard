import assert from "node:assert/strict";
import test from "node:test";
import { RejectReportService } from "../src/lib/reject-report.js";

test("Reject report queries and summarizes only authorized projects", async () => {
  const service = new RejectReportService();
  let capturedJql = "";
  service._getRejectStatusNames = async () => ["Reject"];
  service._searchAllJql = async (jql) => {
    capturedJql = jql;
    return [
      {
        key: "HDV-1",
        fields: {
          project: { key: "HDV", name: "HDV" },
          status: { name: "Reject" },
          summary: "Rejected task",
        },
      },
    ];
  };
  service._getAllProjects = async (projectKeys) => {
    assert.deepEqual(projectKeys, ["HDV", "KFC"]);
    return projectKeys.map((key) => ({ key, name: key }));
  };

  const report = await service.getRejectTasks(["KFC", "HDV", "HDV"]);

  assert.match(capturedJql, /project in \("HDV", "KFC"\)/);
  assert.equal(report.count, 1);
  assert.deepEqual(
    report.projects.map((project) => project.key).sort(),
    ["HDV", "KFC"],
  );
});

test("Reject report skips Jira calls when tenant has no projects", async () => {
  const service = new RejectReportService();
  service._searchAllJql = async () => {
    throw new Error("Jira should not be queried");
  };

  const report = await service.getRejectTasks([]);

  assert.equal(report.count, 0);
  assert.deepEqual(report.projects, []);
  assert.deepEqual(report.rows, []);
});
