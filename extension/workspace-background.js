/* Workspace writes and cloud sessions have one owner: this extension service worker.
 * Pages send only their changes relative to the snapshot they last displayed. */
'use strict';
const workspaceContract = globalThis.TabOutWorkspaceSync;
const workspaceMethods = new Set(['login', 'loginWithVerification', 'register', 'resetPassword', 'logout', 'switchAccount', 'bindContact', 'changePassword', 'getAccountProfile', 'getCaptchaData', 'sendVerification', 'verifyCaptchaData', 'verifyVerification', 'resolveConflict']);
const workspaceAccountMethods = new Set(['login', 'loginWithVerification', 'register', 'resetPassword', 'logout', 'switchAccount', 'resolveConflict']);
let backgroundWorkspace, backgroundSyncClient, workspaceReady;
let workspaceRevision = 0;
let workspaceWrites = Promise.resolve();
let workspaceControls = Promise.resolve();
let workspaceAccountTransition = null;
const WORKSPACE_AUTO_SYNC_INTERVAL_MS = 720000;
const WORKSPACE_AUTO_SYNC_ATTEMPTS_KEY = 'innerGardenWorkspaceAutoSyncAttempts';
const workspaceStorage = {
  async get(key) { return (await chrome.storage.local.get(key))[key]; },
  async set(key, value) { await chrome.storage.local.set({ [key]: value }); },
  async remove(key) { await chrome.storage.local.remove(key); },
};

function workspaceOwnerId() { return backgroundSyncClient.getPublicState().accountId || backgroundSyncClient.accounts.lastAccountId || ''; }
function workspaceSyncThrottleId() { return workspaceOwnerId() || 'signed-out'; }

async function readAutomaticSyncAttempts() {
  return await workspaceStorage.get(WORKSPACE_AUTO_SYNC_ATTEMPTS_KEY) || {};
}

async function automaticSyncIsDue(now = Date.now()) {
  const attempts = await readAutomaticSyncAttempts();
  const lastAttempt = Number(attempts[workspaceSyncThrottleId()] || 0);
  return !Number.isFinite(lastAttempt) || now - lastAttempt >= WORKSPACE_AUTO_SYNC_INTERVAL_MS;
}

async function recordSyncAttempt(now = Date.now()) {
  const attempts = await readAutomaticSyncAttempts();
  attempts[workspaceSyncThrottleId()] = now;
  await workspaceStorage.set(WORKSPACE_AUTO_SYNC_ATTEMPTS_KEY, attempts);
}
function workspaceEnvelope(value) {
  return { value, workspace: workspaceContract.clone(backgroundWorkspace), revision: workspaceRevision, ownerId: workspaceOwnerId(), state: backgroundSyncClient.getPublicState(), rawState: workspaceContract.clone(backgroundSyncClient.state) };
}
function broadcastWorkspace() {
  chrome.runtime.sendMessage({ channel: 'tab-out-workspace-update', ...workspaceEnvelope() }).catch(() => {});
}
function serializeWorkspaceWrite(action) {
  const result = workspaceWrites.then(action);
  workspaceWrites = result.catch(() => {});
  return result;
}
async function saveBackgroundWorkspace() {
  const ownerId = workspaceOwnerId();
  const accounts = await workspaceStorage.get('tabOutAccountWorkspaces') || {};
  if (ownerId) accounts[ownerId] = workspaceContract.clone(backgroundWorkspace);
  workspaceRevision += 1;
  await chrome.storage.local.set({ weeklyWorkspace: backgroundWorkspace, tabOutAccountWorkspaces: accounts, tabOutWorkspaceRevision: workspaceRevision, tabOutWorkspaceOwner: ownerId || 'local' });
  broadcastWorkspace();
}
async function initializeBackgroundWorkspace() {
  const stored = await chrome.storage.local.get(['weeklyWorkspace', 'tabOutWorkspaceRevision', 'tabOutWorkspaceOwner', 'tabOutAccountWorkspaces']);
  backgroundWorkspace = workspaceContract.normalizeWorkspace(stored.weeklyWorkspace);
  workspaceRevision = Number(stored.tabOutWorkspaceRevision || 0);
  backgroundSyncClient = new globalThis.TabOutSyncClient({
    storage: workspaceStorage,
    config: globalThis.TAB_OUT_SYNC_CONFIG || { enabled: false },
    onStatus: update => chrome.runtime.sendMessage({ channel: 'tab-out-workspace-status', update }).catch(() => {}),
  });
  await backgroundSyncClient.load();
  if (stored.tabOutWorkspaceOwner && stored.tabOutWorkspaceOwner !== (workspaceOwnerId() || 'local')) {
    // Preserve the only copy when an interrupted switch or configuration
    // migration has no outgoing snapshot. An existing snapshot may contain
    // newer late edits, so never overwrite it with the visible workspace.
    const accounts = stored.tabOutAccountWorkspaces || {};
    if (stored.weeklyWorkspace && !accounts[stored.tabOutWorkspaceOwner]) {
      accounts[stored.tabOutWorkspaceOwner] = workspaceContract.clone(backgroundWorkspace);
      await workspaceStorage.set('tabOutAccountWorkspaces', accounts);
    }
    backgroundWorkspace = workspaceContract.normalizeWorkspace(accounts[workspaceOwnerId() || 'local']);
  }
  await backgroundSyncClient.initialize(backgroundWorkspace);
  await saveBackgroundWorkspace();
}
async function mergePageWorkspace(message) {
  if (workspaceAccountTransition) await workspaceAccountTransition;
  return serializeWorkspaceWrite(async () => {
    const pageOwner = String(message.ownerId || '');
    if (pageOwner !== workspaceOwnerId()) {
      // A page editing the previous account cannot write its draft into the new account.
      const accounts = await workspaceStorage.get('tabOutAccountWorkspaces') || {};
      const accountKey = pageOwner || 'local';
      accounts[accountKey] = workspaceContract.rebaseWorkspace(message.base, message.workspace, accounts[accountKey] || message.base);
      await workspaceStorage.set('tabOutAccountWorkspaces', accounts);
      return workspaceEnvelope();
    }
    backgroundWorkspace = workspaceContract.rebaseWorkspace(message.base, message.workspace, backgroundWorkspace);
    await saveBackgroundWorkspace();
    await backgroundSyncClient.captureWorkspace(backgroundWorkspace);
    broadcastWorkspace();
    return workspaceEnvelope();
  });
}
async function controlWorkspace(message) {
  await workspaceWrites;
  if (message.method === 'sync') {
    const reason = String(message.reason || 'manual');
    const automatic = reason === 'automatic';
    if (automatic && !await automaticSyncIsDue()) {
      return workspaceEnvelope({ skipped: true, reason: 'throttled', state: backgroundSyncClient.getPublicState() });
    }
    if (automatic) await recordSyncAttempt();
    const result = await backgroundSyncClient.sync(backgroundWorkspace, {
      getWorkspace: () => workspaceContract.clone(backgroundWorkspace),
      applyWorkspace: next => {
        const base = workspaceContract.clone(backgroundWorkspace);
        return serializeWorkspaceWrite(async () => {
          backgroundWorkspace = workspaceContract.rebaseWorkspace(base, backgroundWorkspace, next);
          await saveBackgroundWorkspace();
        });
      },
    });
    if (!automatic) await recordSyncAttempt();
    broadcastWorkspace();
    return workspaceEnvelope({ ...result, trigger: reason, workspace: workspaceContract.clone(backgroundWorkspace) });
  }
  if (!workspaceMethods.has(message.method)) throw new Error('不支持的工作区操作');
  const previousOwner = workspaceOwnerId();
  const previousWorkspace = workspaceContract.clone(backgroundWorkspace);
  const args = message.args || [];
  if (message.method === 'resolveConflict') args[2] = workspaceContract.clone(backgroundWorkspace);
  const value = await backgroundSyncClient[message.method](...args);
  if (workspaceOwnerId() !== previousOwner) {
    const accounts = await workspaceStorage.get('tabOutAccountWorkspaces') || {};
    accounts[previousOwner || 'local'] = previousWorkspace;
    await workspaceStorage.set('tabOutAccountWorkspaces', accounts);
    backgroundWorkspace = accounts[workspaceOwnerId()] || (!previousOwner ? previousWorkspace : workspaceContract.createEmptyWorkspace());
    await backgroundSyncClient.initialize(backgroundWorkspace);
    await saveBackgroundWorkspace();
  } else if (message.method === 'resolveConflict') {
    backgroundWorkspace = value;
    await saveBackgroundWorkspace();
  }
  return workspaceEnvelope(value);
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== 'tab-out-workspace-request') return;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  (async () => {
    workspaceReady ||= initializeBackgroundWorkspace().catch(error => { workspaceReady = null; throw error; });
    await workspaceReady;
    if (message.method === 'initialize') return workspaceEnvelope();
    if (message.method === 'persist') return mergePageWorkspace(message);
    const result = workspaceControls.then(async () => {
      if (!workspaceAccountMethods.has(message.method)) return controlWorkspace(message);
      const transition = controlWorkspace(message);
      workspaceAccountTransition = transition.catch(() => {});
      try { return await transition; } finally { workspaceAccountTransition = null; }
    });
    workspaceControls = result.catch(() => {});
    return result;
  })().then(result => respond({ ok: true, result }), error => respond({ ok: false, error: { message: error.message, syncErrorType: error.syncErrorType, authErrorCode: error.authErrorCode, retryable: error.retryable } }));
  return true;
});

// Migration also goes through both worker write queues; no page writes storage.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== 'inner-garden-device-migration') return;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  const task = workspaceControls.then(async () => {
    if (workspaceReady) await workspaceReady;
    return serializeWorkspaceWrite(() => flomoWrite(async () => {
      const migration = globalThis.InnerGardenDeviceMigration;
      const current = await chrome.storage.local.get(null);
      if (message.method === 'export') return migration.filterStorage(current);
      if (message.method !== 'import') throw new Error('不支持的迁移操作');
      const imported = migration.validatePayload(message.payload);
      if (!migration.isPristineStorage(current, globalThis.InnerGardenFlomo.empty().tags)) {
        throw new Error('当前插件已有本机内容或账号记录；请在空白的新插件中导入');
      }
      await chrome.storage.local.set({ ...imported, innerGardenDeviceMigrationImportedAt: new Date().toISOString() });
      // Only remove initializer keys absent from the imported snapshot. Keep imported content
      // durable before cleanup so a worker interruption cannot discard the migration package.
      const stale = Object.keys(current).filter(key => !(key in imported));
      if (stale.length) await chrome.storage.local.remove(stale);
      workspaceReady = initializeBackgroundWorkspace();
      await workspaceReady;
      chrome.runtime.sendMessage({ channel: 'inner-garden-device-imported' }).catch(() => {});
      return { imported: true };
    }));
  });
  workspaceControls = task.catch(() => {});
  task.then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error.message }));
  return true;
});
