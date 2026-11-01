(function initBrowserClient(root) {
  'use strict';
  const contract = root.TabOutWorkspaceSync;
  root.TabOutWorkspaceBrowserClient = class WorkspaceBrowserClient {
    constructor({ config, onStatus, getWorkspace, applyWorkspace, baseline }) {
      this.config = config;
      this.onStatus = onStatus;
      this.getWorkspace = getWorkspace;
      this.applyWorkspace = applyWorkspace;
      this.baseline = contract.clone(baseline);
      this.ownerId = null;
      this.revision = -1;
      this.publicState = {};
      this.state = {};
      this.restoredChanges = new Set();
      chrome.runtime.onMessage.addListener(message => {
        if (message?.channel === 'tab-out-workspace-update') this.receive(message);
        if (message?.channel === 'tab-out-workspace-status') {
          this.publicState = { ...this.publicState, ...message.update };
          this.onStatus(message.update);
        }
      });
    }
    get enabled() { return Boolean(this.config.enabled && this.config.apiBaseUrl && this.config.authBaseUrl); }
    getPublicState() { return this.publicState; }
    receive(result) {
      if (result.revision < this.revision) return;
      const restored = result.restoredChange;
      const stamp = restored && `${result.ownerId}|${restored.entityType}|${restored.entityId}|${restored.version}|${restored.revision}`;
      const firstRestore = Boolean(stamp && this.ownerId === result.ownerId && !this.restoredChanges.has(stamp));
      if (firstRestore) {
        this.restoredChanges.add(stamp);
        if (this.restoredChanges.size > 100) this.restoredChanges.delete(this.restoredChanges.values().next().value);
        if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('inner-garden-record-restoring', { detail: restored }));
      }
      const current = this.getWorkspace();
      const accountChanged = this.ownerId !== null && this.ownerId !== result.ownerId;
      const firstSnapshot = this.revision < 0;
      let merged;
      if (accountChanged) {
        if (!contract.entitiesEqual(contract.workspaceToEntityMap(this.baseline), contract.workspaceToEntityMap(current))) {
          this.request('persist', { base: this.baseline, workspace: current, ownerId: this.ownerId }).catch(error => this.onStatus({ status: 'error', detail: error.message }));
        }
        merged = result.workspace;
      } else {
        merged = contract.rebaseWorkspace(this.baseline, current, result.workspace);
      }
      this.baseline = contract.clone(result.workspace);
      if (firstRestore) merged = contract.applyEntityChange(merged, restored);
      this.ownerId = result.ownerId;
      this.revision = result.revision;
      this.publicState = result.state;
      this.state = result.rawState;
      // A save acknowledgement must not redraw editors or move the user's caret.
      if (firstSnapshot || accountChanged || !contract.entitiesEqual(contract.workspaceToEntityMap(current), contract.workspaceToEntityMap(merged))) this.applyWorkspace(merged);
      if (firstRestore && typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('inner-garden-record-restored', { detail: restored }));
    }
    async request(method, payload = {}) {
      let response;
      try {
        response = await chrome.runtime.sendMessage({ channel: 'tab-out-workspace-request', method, ...payload });
      } catch (cause) {
        const error = new Error('插件后台连接失败。请在 Chrome 扩展管理页重新加载 Inner Garden，再新开标签页；若仍失败，请查看该插件的后台错误。', { cause });
        error.syncErrorType = 'background-unavailable';
        throw error;
      }
      if (!response?.ok) {
        const error = new Error(response?.error?.message || '后台工作区未响应，请重新打开插件页面后重试。');
        Object.assign(error, response?.error || {});
        throw error;
      }
      this.receive(response.result);
      return response.result;
    }
    async initialize() { return (await this.request('initialize')).state; }
    async captureWorkspace(workspace) {
      const result = await this.request('persist', { base: contract.clone(this.baseline), workspace: contract.clone(workspace), ownerId: this.ownerId });
      return result.state.queued;
    }
    async sync(reason = 'manual') { return (await this.request('sync', { reason })).value; }
  };
  for (const method of ['history', 'historyChanges', 'restoreHistory', 'login', 'loginWithVerification', 'register', 'resetPassword', 'logout', 'switchAccount', 'bindContact', 'changePassword', 'getAccountProfile', 'getCaptchaData', 'sendVerification', 'verifyCaptchaData', 'verifyVerification', 'resolveConflict', 'startDeviceLogin', 'pollDeviceLogin', 'cancelDeviceLogin', 'confirmDeviceLogin']) {
    root.TabOutWorkspaceBrowserClient.prototype[method] = async function (...args) { return (await this.request(method, { args })).value; };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
