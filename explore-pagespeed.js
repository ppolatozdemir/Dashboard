import axios from 'axios';
import fs from 'fs';
import { getConfig } from './src/lib/config.js';

const HEBIAR_BASE_URL = (process.env.HEBIAR_BASE_URL || 'https://hebiar.atlassian.net').replace(/\/$/, '');
const LOG_FILE = 'explore-pagespeed.log';

function log(line) {
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

function client(api) {
  const { email, apiToken } = getConfig();
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  return axios.create({
    baseURL: `${HEBIAR_BASE_URL}${api}`,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: 30000,
  });
}

async function main() {
  fs.writeFileSync(LOG_FILE, `# explore pagespeed — ${new Date().toISOString()}\n`, 'utf8');
  const api = client('/rest/api/3');
  const agile = client('/rest/agile/1.0');

  // 1) Alper Özçelik
  log('\n=== USER SEARCH: Alper ===');
  try {
    const r = await api.get('/user/search', { params: { query: 'Alper', maxResults: 20 } });
    r.data.forEach((u) => log(`${u.accountId} | ${u.displayName} | ${u.emailAddress || '-'} | active=${u.active} | type=${u.accountType}`));
  } catch (e) {
    log(`user search ERR ${e.response?.status} ${e.message}`);
  }

  // 2) Sprint weekly260817 (board 54)
  log('\n=== BOARD 54 SPRINTS (active,future) ===');
  try {
    let startAt = 0;
    for (;;) {
      const r = await agile.get('/board/54/sprint', { params: { state: 'active,future', startAt, maxResults: 50 } });
      r.data.values.forEach((s) => log(`${s.id} | ${s.name} | state=${s.state} | originBoardId=${s.originBoardId}`));
      if (r.data.isLast) break;
      startAt += r.data.values.length;
      if (startAt > 500) break;
    }
  } catch (e) {
    log(`sprints ERR ${e.response?.status} ${e.message}`);
  }

  // 3) CL createmeta for Epic + Task
  log('\n=== CL ISSUE TYPES ===');
  try {
    const r = await api.get('/issue/createmeta/CL/issuetypes');
    r.data.issueTypes.forEach((t) => log(`${t.id} | ${t.name} | subtask=${t.subtask} | hierarchy=${t.hierarchyLevel}`));
  } catch (e) {
    log(`issuetypes ERR ${e.response?.status} ${e.message}`);
  }

  for (const typeId of ['10030', '10029']) {
    log(`\n=== CL CREATEMETA FIELDS for type ${typeId} (required only) ===`);
    try {
      const r = await api.get(`/issue/createmeta/CL/issuetypes/${typeId}`, { params: { maxResults: 200 } });
      r.data.fields
        .filter((f) => f.required)
        .forEach((f) => log(`${f.fieldId} | ${f.name} | required=${f.required} | allowed=${(f.allowedValues || []).slice(0, 20).map((v) => `${v.value || v.name}(${v.id})`).join(', ')}`));
      log('-- optional field ids --');
      log(r.data.fields.filter((f) => !f.required).map((f) => `${f.fieldId}:${f.name}`).join(' | '));
    } catch (e) {
      log(`createmeta ${typeId} ERR ${e.response?.status} ${e.message}`);
      log(JSON.stringify(e.response?.data || {}, null, 2));
    }
  }

  log('\n=== DONE ===');
}

main().catch((e) => log(`FATAL: ${e.message}`));
