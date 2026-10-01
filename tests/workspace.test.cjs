const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../shared/workspace-sync');
const { TabOutSyncClient } = require('../shared/sync-client');
const { workerHarness, clone } = require('./worker-harness.cjs');
const empty = () => W.createEmptyWorkspace('2026-09-30');
const event = id => ({ id, dateKey: '2026-09-30', startMinute: 540, endMinute: 600, title: id, content: '', color: 'yellow' });

test('concurrent page saves preserve independent calendar and daily-log edits', async () => {
  const worker = workerHarness({}, { enabled: false });
  const initial = await worker.request({ method: 'initialize' });
  const a = clone(initial.workspace), b = clone(initial.workspace);
  a.events.push(event('calendar-a')); b.logs['2026-09-30'] = { inspiration: 'page-b' };
  await Promise.all([
    worker.request({ method: 'persist', base: initial.workspace, workspace: a, ownerId: '' }),
    worker.request({ method: 'persist', base: initial.workspace, workspace: b, ownerId: '' }),
  ]);
  assert.equal(worker.data.weeklyWorkspace.events[0].id, 'calendar-a');
  assert.equal(worker.data.weeklyWorkspace.logs['2026-09-30'].inspiration, 'page-b');
  assert.equal(worker.requests.length, 0);
});

test('late writes from a previous account remain in its own snapshot', async () => {
  const base = empty(), late = clone(base); late.logs['2026-09-30'] = { action: 'previous account draft' };
  const worker = workerHarness({}, { enabled: false });
  await worker.request({ method: 'initialize' });
  await worker.request({ method: 'persist', base, workspace: late, ownerId: 'previous-account' });
  assert.equal(worker.data.tabOutAccountWorkspaces['previous-account'].logs['2026-09-30'].action, 'previous account draft');
  assert.equal(worker.data.weeklyWorkspace.logs['2026-09-30'], undefined);
});

test('working offline retains pending operations and local backups', async () => {
  const stored = new Map();
  const storage = { async get(key) { return clone(stored.get(key)); }, async set(key, value) { stored.set(key, clone(value)); }, async remove(key) { stored.delete(key); } };
  let requests = 0;
  const client = new TabOutSyncClient({ storage, config: { enabled: true, authBaseUrl: 'https://service.test/auth', apiBaseUrl: 'https://service.test/sync' }, fetch: async () => { requests++; throw new Error('offline'); } });
  const workspace = empty(); await client.initialize(workspace);
  workspace.events.push(event('offline-event')); await client.captureWorkspace(workspace);
  await assert.rejects(client.sync(workspace), /Sign in/);
  assert.equal(client.state.queue.length, 1);
  assert.equal(client.state.firstBackup.events[0].id, 'offline-event');
  assert.equal(requests, 0);
});

test('daily drafts never become another date\'s synced daily-log fields', () => {
  const workspace = empty(); workspace.dailyDraft = { dateKey: '2026-09-29', inspiration: 'unsaved previous day' };
  workspace.logs['2026-09-30'] = { inspiration: 'today saved' };
  const entities = Object.values(W.workspaceToEntityMap(workspace)).filter(e => e.type === 'daily_log_field');
  assert.equal(entities.length, 1);
  assert.equal(entities[0].payload.dateKey, '2026-09-30');
  assert.equal(entities[0].payload.value, 'today saved');
});

test('workspace sync excludes tabs, focus, flomo and view settings', () => {
  const workspace = { ...empty(), tabs: ['private'], focusTimer: { remainingMs: 20 }, flomo: [{ body: 'private' }], preference: 'dark' };
  assert.deepEqual(W.workspaceToEntityMap(workspace), {});
});

test('rebase retains remote changes while applying a local deletion', () => {
  const base = empty(); base.events = [event('deleted')];
  const local = clone(base); local.events = [];
  const remote = clone(base); remote.events.push(event('remote-new'));
  const result = W.rebaseWorkspace(base, local, remote);
  assert.deepEqual(result.events.map(e => e.id), ['remote-new']);
});

test('automatic triggers are throttled persistently while manual sync remains immediate', async () => {
  const worker = workerHarness({}, { enabled: false });
  await worker.request({ method: 'initialize' });
  const first = await worker.request({ method: 'sync', reason: 'automatic' });
  const second = await worker.request({ method: 'sync', reason: 'automatic' });
  const manual = await worker.request({ method: 'sync', reason: 'manual' });
  assert.equal(first.value.skipped, undefined);
  assert.equal(second.value.skipped, true);
  assert.equal(manual.value.trigger, 'manual');
  const restarted = workerHarness(worker.data, { enabled: false });
  const again = await restarted.request({ method: 'sync', reason: 'automatic' });
  assert.equal(again.value.skipped, true);
});
