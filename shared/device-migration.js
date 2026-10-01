(function initDeviceMigration(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.InnerGardenDeviceMigration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function deviceMigrationFactory() {
  'use strict';
  const schema = 'inner-garden-device-migration-v1';
  const authStorageKey = /^tabOutSyncAuth(?:Accounts)?(?::|$)/;
  const syncStateKey = /^tabOutSyncState(?::|$)/;
  const accountStatesKey = /^tabOutSyncStateAccounts(?::|$)/;

  function filterStorage(storage) {
    return Object.fromEntries(Object.entries(storage || {})
      .filter(([key]) => !authStorageKey.test(key) && key !== 'innerGardenWorkspaceAutoSyncAttempts')
      .map(([key, value]) => {
        if (syncStateKey.test(key)) return [key, { ...value, deviceId: '' }];
        if (accountStatesKey.test(key)) {
          const states = Object.fromEntries(Object.entries(value?.states || {}).map(([accountId, state]) => [accountId, { ...state, deviceId: '' }]));
          return [key, { ...value, states }];
        }
        return [key, value];
      }));
  }

  function validatePayload(payload) {
    if (payload?.schema !== schema || !payload.data || Array.isArray(payload.data) || typeof payload.data !== 'object') {
      throw new Error('这不是有效的 Inner Garden 设备迁移包');
    }
    if (Object.keys(payload.data).some(key => authStorageKey.test(key))) {
      throw new Error('迁移包包含登录会话，已拒绝导入');
    }
    return filterStorage(payload.data);
  }

  function emptyObject(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0; }
  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
    return value;
  }
  function blankWorkspace(value) {
    if (!value || value.version !== 3) return false;
    const keys = new Set(['version', 'events', 'logs', 'planner', 'dailyDraft', 'weekPlanItems', 'weekPlans', 'selectedWeekStartKey', 'activeWeekStartKey', 'activeWeekId']);
    if (Object.keys(value).some(key => !keys.has(key))) return false;
    if (['events', 'weekPlanItems'].some(key => !Array.isArray(value[key]) || value[key].length)) return false;
    if (['logs', 'planner', 'weekPlans'].some(key => !emptyObject(value[key]))) return false;
    return !value.dailyDraft || Object.entries(value.dailyDraft).every(([key, field]) => key === 'dateKey' || field === '');
  }
  function blankSyncState(value) {
    if (!value || typeof value !== 'object') return false;
    const keys = new Set(['deviceId', 'cursor', 'versions', 'baseline', 'queue', 'conflicts', 'recoveryHistory', 'clockOffsetMs', 'lastSyncedAt', 'lastSyncSummary', 'lastUsername', 'seeded', 'firstBackup', 'firstBackupLocked']);
    if (Object.keys(value).some(key => !keys.has(key))) return false;
    return ['queue', 'conflicts', 'recoveryHistory'].every(key => Array.isArray(value[key]) && !value[key].length)
      && emptyObject(value.versions) && emptyObject(value.baseline) && value.cursor === 0
      && !value.lastSyncedAt && !value.lastUsername && !value.lastSyncSummary && !value.firstBackupLocked
      && !value.clockOffsetMs && (!value.firstBackup || blankWorkspace(value.firstBackup));
  }
  function isPristineStorage(storage, defaultFlomoTags = []) {
    return Object.entries(storage || {}).every(([key, value]) => {
      if (key === 'weeklyWorkspace') return blankWorkspace(value);
      if (key === 'tabOutWorkspaceRevision') return Number.isSafeInteger(value) && value >= 0;
      if (key === 'tabOutWorkspaceOwner') return value === 'local';
      if (key === 'tabOutAccountWorkspaces') return emptyObject(value);
      if (/^tabOutSyncAuthAccounts(?::|$)/.test(key)) return value?.version === 1 && !value.activeAccountId && !value.lastAccountId && emptyObject(value.sessions) && Object.keys(value).every(key => ['version', 'activeAccountId', 'lastAccountId', 'sessions'].includes(key));
      if (authStorageKey.test(key)) return false;
      if (accountStatesKey.test(key)) return value?.version === 1 && emptyObject(value.states) && Object.keys(value).every(key => ['version', 'states'].includes(key));
      if (syncStateKey.test(key)) return blankSyncState(value);
      if (key === 'innerGardenFlomo:local') return value?.version === 1 && Array.isArray(value.notes) && !value.notes.length && !value.draft
        && JSON.stringify(stableValue(value.tags)) === JSON.stringify(stableValue(defaultFlomoTags))
        && Object.keys(value).every(key => ['version', 'notes', 'tags', 'draft', 'defaultTagsVersion', 'promptSeedVersion'].includes(key));
      return false;
    });
  }

  return { schema, filterStorage, validatePayload, isPristineStorage };
});
