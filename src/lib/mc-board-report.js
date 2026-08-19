import axios from "axios";
import { getConfig } from "./config.js";

/**
 * "MC Panosu" (Kanban board) raporu:
 * Hebiar (Commercelab) Jira'sındaki MC ("Madame Coco") projesinin maddelerini,
 * projenin gerçek Kanban board'undaki (board 50) sütun düzenine göre statü bazında
 * gruplar. Her sütun bir statü kolonudur; içinde o statüdeki task kartları listelenir.
 *
 * Not: Hebiar sabit URL'dir; config.baseUrl Olka'yı gösterse bile bu rapor daima
 * Hebiar'a bağlanır (HEBIAR_BASE_URL ile override edilebilir).
 */

const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");

const PROJECT_KEY = process.env.MC_BOARD_PROJECT || "MC";
// "Tamamlandı" (Done) kategorisindeki maddeler on binlerce olabildiğinden pano
// yalnızca son N gün içinde güncellenen Done maddelerini kart olarak gösterir.
const RECENT_DAYS = parseInt(process.env.MC_BOARD_RECENT_DAYS || "45", 10);
// Done sütunu için çekilecek kart üst sınırı (performans için).
const DONE_FETCH_CAP = parseInt(process.env.MC_BOARD_DONE_CAP || "120", 10);
// Her sütunda ekranda gösterilecek kart üst sınırı.
const DISPLAY_CAP = parseInt(process.env.MC_BOARD_DISPLAY_CAP || "80", 10);

class McBoardReportService {
  getAuthHeader() {
    const { email, apiToken } = getConfig();
    if (!email || !apiToken) {
      throw new Error(
        'Jira kimlik bilgileri eksik. Önce "jira config setup" komutunu çalıştırın.',
      );
    }
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    return {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /**
   * Yeni "Enhanced JQL" search endpoint'i ile bir sorgunun sonuçlarını
   * (nextPageToken ile sayfalı) çeker. cap verilirse o kadar kayıt toplanınca durur.
   */
  async _searchAllJql(jql, fields, cap = Infinity) {
    const headers = this.getAuthHeader();
    let nextPageToken = null;
    let pages = 0;
    const all = [];

    do {
      const params = { jql, fields: fields.join(","), maxResults: 100 };
      if (nextPageToken) params.nextPageToken = nextPageToken;

      const res = await axios.get(`${HEBIAR_BASE_URL}/rest/api/3/search/jql`, {
        params,
        headers,
      });

      all.push(...(res.data.issues || []));
      nextPageToken = res.data.isLast ? null : res.data.nextPageToken || null;
      pages++;
    } while (nextPageToken && all.length < cap && pages < 60);

    return cap === Infinity ? all : all.slice(0, cap);
  }

  /**
   * Bir JQL için yaklaşık toplam kayıt sayısını döner (sütun başlığındaki gerçek
   * toplam için). Erişilemezse null döner (çağıran taraf gösterilen kart sayısına düşer).
   */
  async _approxCount(jql) {
    try {
      const headers = this.getAuthHeader();
      const res = await axios.post(
        `${HEBIAR_BASE_URL}/rest/api/3/search/approximate-count`,
        { jql },
        { headers },
      );
      return typeof res.data?.count === "number" ? res.data.count : null;
    } catch (err) {
      return null;
    }
  }

  /** MC projesinin Kanban board'unu bulur (tercihen "simple"/kanban tipi). */
  async _getBoard() {
    const headers = this.getAuthHeader();
    const res = await axios.get(`${HEBIAR_BASE_URL}/rest/agile/1.0/board`, {
      params: { projectKeyOrId: PROJECT_KEY },
      headers,
    });
    const boards = res.data.values || [];
    if (!boards.length) return null;
    return (
      boards.find((b) => (b.type || "").toLowerCase() !== "scrum") || boards[0]
    );
  }

  /** Board'un sütun yapılandırmasını (sıralı sütunlar + eşlenen statü id'leri) döner. */
  async _getBoardColumns(boardId) {
    const headers = this.getAuthHeader();
    const res = await axios.get(
      `${HEBIAR_BASE_URL}/rest/agile/1.0/board/${boardId}/configuration`,
      { headers },
    );
    return (res.data.columnConfig?.columns || []).map((c) => ({
      name: c.name,
      statusIds: (c.statuses || []).map((s) => String(s.id)),
    }));
  }

  /** Projede kullanılan statülerin id -> {name, category} eşlemesini döner. */
  async _getStatusMeta() {
    const headers = this.getAuthHeader();
    const res = await axios.get(
      `${HEBIAR_BASE_URL}/rest/api/3/project/${PROJECT_KEY}/statuses`,
      { headers },
    );
    const map = {};
    for (const it of res.data || []) {
      for (const s of it.statuses || []) {
        map[String(s.id)] = {
          name: s.name,
          category: s.statusCategory?.key || "undefined",
        };
      }
    }
    return map;
  }

  /** Board bulunamazsa: statüleri kategoriye göre (yeni -> devam -> tamam) sütunlara böler. */
  _fallbackColumns(statusMeta) {
    const order = { new: 0, indeterminate: 1, done: 2, undefined: 3 };
    const ids = Object.keys(statusMeta).sort(
      (a, b) =>
        (order[statusMeta[a].category] ?? 3) -
        (order[statusMeta[b].category] ?? 3),
    );
    return ids.map((id) => ({ name: statusMeta[id].name, statusIds: [id] }));
  }

  _mapIssue(issue) {
    const f = issue.fields || {};
    const st = f.status || {};
    return {
      key: issue.key,
      summary: f.summary || "",
      statusId: st.id ? String(st.id) : null,
      statusName: st.name || "",
      statusCategory: st.statusCategory?.key || "undefined",
      assignee: f.assignee ? f.assignee.displayName : null,
      priority: f.priority ? f.priority.name : null,
      issueType: f.issuetype ? f.issuetype.name : null,
      created: f.created || null,
      updated: f.updated || null,
    };
  }

  async getBoardData() {
    const fields = [
      "summary",
      "status",
      "assignee",
      "priority",
      "issuetype",
      "created",
      "updated",
    ];

    const statusMeta = await this._getStatusMeta();
    const board = await this._resolveBoard(statusMeta);
    const activeJql = `project = "${PROJECT_KEY}" AND statusCategory != Done ORDER BY updated DESC`;
    const doneJql = `project = "${PROJECT_KEY}" AND statusCategory = Done AND updated >= -${RECENT_DAYS}d ORDER BY updated DESC`;
    const [activeIssues, doneIssues] = await Promise.all([
      this._searchAllJql(activeJql, fields),
      this._searchAllJql(doneJql, fields, DONE_FETCH_CAP),
    ]);
    const rows = [...activeIssues, ...doneIssues].map((i) => this._mapIssue(i));
    const { columns, totalTrue } = await this._buildColumns(
      board.columns,
      statusMeta,
      this._groupByStatus(rows),
    );
    return {
      project: PROJECT_KEY,
      projectName: board.name
        ? board.name.replace(/\s*board$/i, "").trim()
        : PROJECT_KEY,
      boardId: board.id,
      boardName: board.name,
      recentDays: RECENT_DAYS,
      totalTrue,
      activeCount: activeIssues.length,
      generatedAt: new Date().toISOString(),
      columns,
    };
  }

  async _resolveBoard(statusMeta) {
    let board = { id: null, name: null, columns: null };
    try {
      const selected = await this._getBoard();
      if (selected) {
        board = {
          id: selected.id,
          name: selected.name,
          columns: await this._getBoardColumns(selected.id),
        };
      }
    } catch (error) {
      board.columns = null;
    }
    if (!board.columns || !board.columns.length) {
      board.columns = this._fallbackColumns(statusMeta);
    }
    return board;
  }

  _groupByStatus(rows) {
    const grouped = new Map();
    for (const row of rows) {
      if (!row.statusId) continue;
      if (!grouped.has(row.statusId)) grouped.set(row.statusId, []);
      grouped.get(row.statusId).push(row);
    }
    return grouped;
  }

  async _buildColumns(definitions, statusMeta, byStatus) {
    const columns = [];
    let totalTrue = 0;
    for (const definition of definitions) {
      const statusIds = (definition.statusIds || []).filter(Boolean);
      const cards = statusIds.flatMap((id) => byStatus.get(id) || []);
      cards.sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));
      const shown = cards.slice(0, DISPLAY_CAP);
      const count = await this._columnCount(statusIds, cards.length);
      totalTrue += count;
      const knownStatus = statusIds.find((id) => statusMeta[id]);
      columns.push({
        name: definition.name,
        statusIds,
        statusNames: statusIds
          .map((id) => statusMeta[id]?.name)
          .filter(Boolean),
        category: knownStatus ? statusMeta[knownStatus].category : "undefined",
        count,
        shownCount: shown.length,
        cards: shown,
      });
    }
    return { columns, totalTrue };
  }

  async _columnCount(statusIds, fallback) {
    if (!statusIds.length) return fallback;
    const jql = `project = "${PROJECT_KEY}" AND status in (${statusIds.join(
      ",",
    )})`;
    return (await this._approxCount(jql)) ?? fallback;
  }
}

export default new McBoardReportService();
