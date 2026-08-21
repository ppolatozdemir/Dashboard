import { getHebiarClient } from "../../shared/hebiar-client.js";
import { authorizeTaskProject } from "../../auth/task-policy.js";
import { requireConfiguration } from "./controller-utils.js";

async function resolveIssueType(client, projectKey) {
  let issueType = { name: "Task" };
  try {
    const response = await client.get(
      `/issue/createmeta/${projectKey}/issuetypes`,
    );
    const types = (response.data.issueTypes || []).filter(
      (type) => !type.subtask,
    );
    const picked = types.find((type) => /^(task|görev)$/i.test(type.name)) ||
      types[0];
    if (picked) issueType = { id: picked.id };
  } catch (error) {
    console.error("Issue type belirlenemedi:", error.message);
  }
  return issueType;
}

function descriptionDocument(description) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: description || "" }],
      },
    ],
  };
}

async function assignIssue(client, issueKey, assigneeId) {
  if (!assigneeId) return null;
  try {
    await client.put(`/issue/${issueKey}/assignee`, {
      accountId: assigneeId,
    });
    const response = await client.get("/user", {
      params: { accountId: assigneeId },
    });
    return response.data.displayName || "Atandı";
  } catch (error) {
    console.error("Assignee atanamadı:", error.message);
    return null;
  }
}

async function addIssueToSprint(client, issueKey, sprintId) {
  if (!sprintId) return null;
  try {
    await client.post(`/sprint/${sprintId}/issue`, { issues: [issueKey] });
    const response = await client.get(`/sprint/${sprintId}`);
    return response.data.name;
  } catch (error) {
    console.error("Sprint eklenemedi:", error.message);
    return null;
  }
}

function jiraErrorMessage(error) {
  const data = error.response?.data;
  return data
    ? [
        ...(data.errorMessages || []),
        ...Object.values(data.errors || {}),
      ].join(" | ")
    : "";
}

export async function createTask(req, res) {
  try {
    if (!requireConfiguration(res)) return;
    const { projectKey, summary, description, sprintId, assigneeId } = req.body;
    if (!projectKey || !summary) {
      return res
        .status(400)
        .json({ error: "Proje ve konu başlığı zorunludur" });
    }
    authorizeTaskProject(req.auth, projectKey);
    const client = getHebiarClient();
    const agileClient = getHebiarClient("/rest/agile/1.0");
    const issueType = await resolveIssueType(client, projectKey);
    const response = await client.post("/issue", {
      fields: {
        project: { key: projectKey },
        summary,
        description: descriptionDocument(description),
        issuetype: issueType,
      },
    });
    const issueKey = response.data.key;
    const assignee = await assignIssue(client, issueKey, assigneeId);
    const sprint = await addIssueToSprint(agileClient, issueKey, sprintId);
    console.log(`✅ Task oluşturuldu: ${issueKey} - ${summary}`);
    res.json({ success: true, key: issueKey, summary, assignee, sprint });
  } catch (error) {
    const detail = jiraErrorMessage(error);
    console.error("Task oluşturma hatası:", detail || error.message);
    res.status(error.status || 500).json({ error: detail || error.message });
  }
}
