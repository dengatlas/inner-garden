const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../shared/device-migration');
const { workerHarness } = require('./worker-harness.cjs');
const payload = data => ({ schema: M.schema, data });

test('migration removes all environment-scoped auth sessions and resets device IDs', () => {
  const source = { 'tabOutSyncAuth:env': { accessToken: 'synthetic' }, 'tabOutSyncAuthAccounts:env': { sessions: { a: {} } },
    'tabOutSyncState:env': { deviceId: 'old', queue: [{ opId: 'keep' }] },
    'tabOutSyncStateAccounts:env': { states: { a: { deviceId: 'old-account', cursor: 8 } } },
    weeklyWorkspace: { version: 3 }, innerGardenWorkspaceAutoSyncAttempts: { a: 1 } };
  const result = M.filterStorage(source);
  assert.equal(result['tabOutSyncAuth:env'], undefined);
  assert.equal(result['tabOutSyncAuthAccounts:env'], undefined);
  assert.equal(result['tabOutSyncState:env'].deviceId, '');
  assert.equal(result['tabOutSyncStateAccounts:env'].states.a.deviceId, '');
  assert.equal(result['tabOutSyncState:env'].queue[0].opId, 'keep');
  assert.equal(result.innerGardenWorkspaceAutoSyncAttempts, undefined);
});

test('import rejects auth payloads and unsupported schemas', () => {
  assert.throws(() => M.validatePayload(payload({ 'tabOutSyncAuth:env': {} })), /登录会话/);
  assert.throws(() => M.validatePayload({ schema: 'wrong', data: {} }), /有效/);
});

test('imports use reset device IDs even for a hand-crafted payload', () => {
  assert.equal(M.validatePayload(payload({ tabOutSyncState: { deviceId: 'do-not-reuse' } })).tabOutSyncState.deviceId, '');
});

test('fresh initialized workspace and default flomo tags permit migration through worker', async () => {
  const worker = workerHarness({}, { enabled: false });
  await worker.request({ method: 'initialize' });
  await worker.message({ channel: 'inner-garden-flomo-request', method: 'read', owner: '' });
  const imported = await worker.message({ channel: 'inner-garden-device-migration', method: 'import', payload: payload({ deferredItems: [{ id: 'saved', title: 'synthetic' }] }) });
  assert.equal(imported.ok, true);
  assert.equal(worker.data.deferredItems[0].id, 'saved');
  assert.ok(worker.data.innerGardenDeviceMigrationImportedAt);
  assert.equal((await worker.message({ channel: 'inner-garden-device-migration', method: 'import', payload: payload({}) })).ok, false);
});

test('saved content prevents migration without altering any stored value', async () => {
  const worker = workerHarness({}, { enabled: false });
  const initial = await worker.request({ method: 'initialize' });
  const workspace = structuredClone(initial.workspace); workspace.logs['2026-09-30'] = { plan: 'keep me' };
  await worker.request({ method: 'persist', base: initial.workspace, workspace, ownerId: '' });
  const before = JSON.stringify(worker.data);
  const result = await worker.message({ channel: 'inner-garden-device-migration', method: 'import', payload: payload({}) });
  assert.equal(result.ok, false); assert.equal(JSON.stringify(worker.data), before);
});

test('flomo drafts, new tags, account snapshots and unknown storage prevent overwrite', async () => {
  for (const addition of [
    { privateSetting: 'keep' }, { tabOutAccountWorkspaces: { a: {} } },
    { 'tabOutSyncAuth:env': { accessToken: 'synthetic' } },
    { 'innerGardenFlomo:local': { version: 1, notes: [], tags: [], draft: { body: 'unsaved' } } },
    { weeklyWorkspace: { version: 3, dailyDraft: { inspiration: 'draft' }, events: [], logs: {}, planner: {}, weekPlanItems: [], weekPlans: {} } },
  ]) assert.equal(M.isPristineStorage(addition), false);
});

test('Chrome storage object-key ordering does not turn default tags into user content', () => {
  const F = require('../shared/flomo');
  const state = F.empty(); state.promptSeedVersion = 2;
  const reordered = JSON.parse(JSON.stringify(state, (key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value));
  assert.equal(M.isPristineStorage({ 'innerGardenFlomo:local': reordered }, F.empty().tags), true);
  reordered.tags[0].pinned = true;
  assert.equal(M.isPristineStorage({ 'innerGardenFlomo:local': reordered }, F.empty().tags), false);
});

test('export is coordinated and never includes authentication sessions', async () => {
  const worker = workerHarness({ 'tabOutSyncAuthAccounts:env': { sessions: { a: { accessToken: 'synthetic' } } }, savedForLater: [{ id: 'keep' }] });
  const result = await worker.message({ channel: 'inner-garden-device-migration', method: 'export' });
  assert.equal(result.ok, true);
  assert.equal(result.result['tabOutSyncAuthAccounts:env'], undefined);
  assert.equal(result.result.savedForLater[0].id, 'keep');
});
