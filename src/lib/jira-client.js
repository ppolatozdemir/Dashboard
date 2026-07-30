import axios from 'axios';
import { getConfig } from './config.js';

class JiraClient {
  constructor() {
    this.client = null;
    this.baseUrl = null;
    this.auth = null;
  }

  init() {
    const { baseUrl, email, apiToken } = getConfig();
    
    if (!baseUrl || !email || !apiToken) {
      throw new Error('Jira yapılandırması eksik. Önce "jira config" komutunu çalıştırın.');
    }

    this.baseUrl = baseUrl;
    this.auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    
    this.client = axios.create({
      baseURL: `${baseUrl}/rest/api/3`,
      headers: {
        'Authorization': `Basic ${this.auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    return this;
  }

  // Yeni search/jql endpoint'i kullanır
  async searchIssuesJql(jql, fields = [], maxResults = 100) {
    const response = await this.client.get('/search/jql', {
      params: {
        jql,
        fields: fields.join(','),
        maxResults
      }
    });
    
    return response.data.issues || [];
  }

  // Issue Operations
  async getIssue(issueKey) {
    const response = await this.client.get(`/issue/${issueKey}`);
    return response.data;
  }

  async searchIssues(jql, maxResults = 50) {
    const response = await this.client.post('/search', {
      jql,
      maxResults,
      fields: ['summary', 'status', 'assignee', 'priority', 'issuetype', 'created', 'updated', 'project']
    });
    return response.data;
  }

  async createIssue(projectKey, summary, description, issueType = 'Task') {
    const response = await this.client.post('/issue', {
      fields: {
        project: { key: projectKey },
        summary,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: description || '' }]
            }
          ]
        },
        issuetype: { name: issueType }
      }
    });
    return response.data;
  }

  async updateIssue(issueKey, fields) {
    const response = await this.client.put(`/issue/${issueKey}`, { fields });
    return response.data;
  }

  async deleteIssue(issueKey) {
    await this.client.delete(`/issue/${issueKey}`);
    return true;
  }

  async assignIssue(issueKey, accountId) {
    await this.client.put(`/issue/${issueKey}/assignee`, { accountId });
    return true;
  }

  async transitionIssue(issueKey, transitionId) {
    await this.client.post(`/issue/${issueKey}/transitions`, {
      transition: { id: transitionId }
    });
    return true;
  }

  async getTransitions(issueKey) {
    const response = await this.client.get(`/issue/${issueKey}/transitions`);
    return response.data.transitions;
  }

  // Comments
  async getComments(issueKey) {
    const response = await this.client.get(`/issue/${issueKey}/comment`);
    return response.data.comments;
  }

  async addComment(issueKey, body) {
    const response = await this.client.post(`/issue/${issueKey}/comment`, {
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: body }]
          }
        ]
      }
    });
    return response.data;
  }

  // Projects
  async getProjects() {
    const response = await this.client.get('/project');
    return response.data;
  }

  async getProject(projectKey) {
    const response = await this.client.get(`/project/${projectKey}`);
    return response.data;
  }

  // Users
  async searchUsers(query) {
    const response = await this.client.get('/user/search', {
      params: { query }
    });
    return response.data;
  }

  async getCurrentUser() {
    const response = await this.client.get('/myself');
    return response.data;
  }

  // Boards & Sprints (Agile API)
  async getBoards(projectKey) {
    const { baseUrl, email, apiToken } = getConfig();
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    
    const response = await axios.get(`${baseUrl}/rest/agile/1.0/board`, {
      params: projectKey ? { projectKeyOrId: projectKey } : {},
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.values;
  }

  async getSprints(boardId, state = 'active') {
    const { baseUrl, email, apiToken } = getConfig();
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    
    const response = await axios.get(`${baseUrl}/rest/agile/1.0/board/${boardId}/sprint`, {
      params: { state },
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.values;
  }

  async getSprintIssues(sprintId) {
    const { baseUrl, email, apiToken } = getConfig();
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    
    const response = await axios.get(`${baseUrl}/rest/agile/1.0/sprint/${sprintId}/issue`, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.issues;
  }

  // Issue Types
  async getIssueTypes() {
    const response = await this.client.get('/issuetype');
    return response.data;
  }

  // Priorities
  async getPriorities() {
    const response = await this.client.get('/priority');
    return response.data;
  }

  // Statuses
  async getStatuses() {
    const response = await this.client.get('/status');
    return response.data;
  }
}

export default new JiraClient();
