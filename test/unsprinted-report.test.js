import assert from "node:assert/strict";
import test from "node:test";
import { UnsprintedReportService } from "../src/lib/unsprinted-report.js";

test("Unsprinted report excludes Olka tasks linked to the selected Hebiar sprint", async () => {
  const service = new UnsprintedReportService();
  service.getCllinkFieldId = async () => "customfield_123";
  service._fetchAllSprintIssues = async (baseUrl) => {
    if (baseUrl.includes("olkaproduct")) {
      return [
        {
          key: "OLK-1",
          fields: {
            summary: "Already planned",
            customfield_123: "https://hebiar.atlassian.net/browse/CL-10",
          },
        },
        {
          key: "OLK-2",
          fields: {
            summary: "Missing from weekly sprint",
            customfield_123: "CL-11",
          },
        },
      ];
    }
    return [{ key: "CL-10", fields: { summary: "Weekly task" } }];
  };

  const report = await service.getUnsprintedTasks("100", "200");

  assert.equal(report.olkaTotal, 2);
  assert.equal(report.hebiarTotal, 1);
  assert.deepEqual(report.rows.map((row) => row.olkaKey), ["OLK-2"]);
  assert.equal(report.rows[0].clKey, "CL-11");
});
