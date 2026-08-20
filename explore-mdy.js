import axios from "axios";
import { getConfig } from "./src/lib/config.js";

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");

function hebiarClient() {
  const { email, apiToken } = getConfig();
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return axios.create({
    baseURL: `${HEBIAR_BASE_URL}/rest/api/3`,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
}

async function main() {
  const client = hebiarClient();
  const out = {};

  // 1) Project info
  try {
    const proj = await client.get("/project/MDY");
    out.project = {
      key: proj.data.key,
      name: proj.data.name,
      style: proj.data.style, // 'classic' (company-managed) or 'next-gen' (team-managed)
      simplified: proj.data.simplified,
      id: proj.data.id,
    };
  } catch (e) {
    out.projectError =
      e.response?.status + " " + JSON.stringify(e.response?.data || e.message);
  }

  // 2) Create meta -> issue types for MDY
  try {
    const meta = await client.get("/issue/createmeta", {
      params: { projectKeys: "MDY", expand: "projects.issuetypes" },
    });
    const project = meta.data.projects?.[0];
    out.issueTypes = (project?.issuetypes || []).map((it) => ({
      id: it.id,
      name: it.name,
      subtask: it.subtask,
    }));
  } catch (e) {
    out.metaError =
      e.response?.status + " " + JSON.stringify(e.response?.data || e.message);
  }

  // 3) Find Tahir Polat Özdemir account
  try {
    const users = await client.get("/user/search", {
      params: { query: "Tahir Polat Özdemir" },
    });
    out.users = users.data.map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName,
      active: u.active,
    }));
  } catch (e) {
    out.userError =
      e.response?.status + " " + JSON.stringify(e.response?.data || e.message);
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => console.error("FATAL", e.response?.data || e.message));
