const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function workerHarness(initial = {}, overrides = {}) {
  const data = clone(initial), listeners = [], broadcasts = [], requests = [];
  const event = () => ({ addListener() {} });
  const runtimeId = 'test-extension';
  const chrome = {
    storage: { local: {
      async get(keys) {
        if (keys === null) return clone(data);
        const result = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) if (key in data) result[key] = clone(data[key]);
        return result;
      },
      async set(values) { for (const [key, value] of Object.entries(values)) data[key] = clone(value); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
    } },
    runtime: {
      id: runtimeId, getURL: suffix => `chrome-extension://${runtimeId}/${suffix}`,
      onMessage: { addListener: fn => listeners.push(fn) }, onConnect: event(),
      onInstalled: event(), onStartup: event(),
      async sendMessage(message) { broadcasts.push(clone(message)); },
    },
    tabs: { async query() { return []; }, onCreated: event(), onRemoved: event(), onUpdated: event() },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
  };
  const context = vm.createContext({ chrome, crypto: webcrypto, console, URL, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, navigator: { onLine: true },
    fetch: async (...args) => { requests.push(args); throw new Error('Network unavailable in test'); },
  });
  context.importScripts = (...files) => {
    for (const file of files) {
      if (file === 'config.local.js') { context.TAB_OUT_SYNC_CONFIG = { ...context.TAB_OUT_SYNC_CONFIG, ...overrides }; continue; }
      vm.runInContext(fs.readFileSync(path.join(root, 'extension', file), 'utf8'), context, { filename: file });
      if (file === 'config.js') context.TAB_OUT_LOAD_LOCAL_CONFIG = true;
    }
  };
  context.importScripts('background.js');
  async function message(payload, sender = { id: runtimeId, url: `chrome-extension://${runtimeId}/index.html` }) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker response timed out')), 2000);
      const respond = value => { clearTimeout(timer); resolve(clone(value)); };
      for (const listener of listeners) listener(clone(payload), sender, respond);
    });
  }
  const request = async payload => {
    const response = await message({ channel: 'tab-out-workspace-request', ...payload });
    if (!response.ok) throw new Error(response.error?.message || response.error);
    return response.result;
  };
  return { data, context, broadcasts, requests, message, request };
}
module.exports = { workerHarness, clone, root };
