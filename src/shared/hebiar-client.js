import axios from "axios";
import { getConfig } from "../lib/config.js";

export const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");

export const HEBIAR_WEEKLY_BOARD_ID =
  process.env.HEBIAR_WEEKLY_BOARD_ID || "54";

export function getHebiarClient(apiPath = "/rest/api/3") {
  const { email, apiToken } = getConfig();
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return axios.create({
    baseURL: `${HEBIAR_BASE_URL}${apiPath}`,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 30000,
  });
}
