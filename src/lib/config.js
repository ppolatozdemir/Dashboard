import Conf from 'conf';

const config = new Conf({
  projectName: 'jira-cli',
  schema: {
    baseUrl: {
      type: 'string',
      default: ''
    },
    email: {
      type: 'string',
      default: ''
    },
    apiToken: {
      type: 'string',
      default: ''
    },
    defaultProject: {
      type: 'string',
      default: ''
    }
  }
});

export function getConfig() {
  return {
    baseUrl: config.get('baseUrl'),
    email: config.get('email'),
    apiToken: config.get('apiToken'),
    defaultProject: config.get('defaultProject')
  };
}

export function setConfig(key, value) {
  config.set(key, value);
}

export function isConfigured() {
  const cfg = getConfig();
  return cfg.baseUrl && cfg.email && cfg.apiToken;
}

export function clearConfig() {
  config.clear();
}

export default config;
