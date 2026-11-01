'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../shared/workspace-sync');
const { TabOutSyncClient } = require('../shared/sync-client');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(body); } });
const event = (id, content = id) => ({ id, dateKey: '2026-11-01', weekId: '2026-W44', startMinute: 540, endMinute: 570, title: id, content, color: 'white' });
async function fixture(fetch) {
  const data = {};
  const storage = { async get(key) { return clone(data[key]); }, async set(key, value) { data[key] = clone(value); }, async remove(key) { delete data[key]; } };
  const client = new TabOutSyncClient({ storage, explicitDeletes: true, fetch, config: { enabled: true, apiBaseUrl: 'https://sync.test', authBaseUrl: 'https://auth.test' } });
  const workspace = W.createEmptyWorkspace('2026-11-01'); workspace.events.push(event('a'));
  await client.initialize(workspace);
  client.auth = { accountId: 'uid:one', accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: Date.now() + 3600000, trustedUntil: new Date(Date.now() + 3600000).toISOString() };
  client.accounts.lastAccountId = 'uid:one'; client.state.queue = []; client.state.cursor = 10;
  return { client, data, workspace, storage };
}
test('strict snapshot capture cannot turn a missing event into a deletion', async () => {
  const { client, workspace } = await fixture(async () => response({}));
  const incomplete = clone(workspace); incomplete.events = [];
  await client.captureWorkspace(incomplete);
  assert.equal(client.state.queue.length, 0);
  assert.equal(client.latestWorkspace.events[0].id, 'a');
  assert.ok(client.state.baseline['calendar_event::a']);
  await client.captureWorkspace(incomplete, { deletedEntities: [{ entityType: 'calendar_event', entityId: 'a' }] });
  assert.equal(client.state.queue[0].action, 'delete');
});
test('history network fallback is scoped to account, with explicit cached status', async () => {
  let fail = false;
  const { client } = await fixture(async () => { if (fail) throw Error('offline'); return response({ current: { version: 1 }, versions: [] }); });
  await client.history({ entityType: 'calendar_event', entityId: 'a' });
  fail = true;
  assert.equal((await client.history({ entityType: 'calendar_event', entityId: 'a' })).cached, true);
  client.auth.accountId = 'uid:two';
  await assert.rejects(client.history({ entityType: 'calendar_event', entityId: 'a' }), /offline/);
});
test('history auth rejection is never hidden by a cached success', async () => {
  let denied = false;
  const { client } = await fixture(async () => denied ? response({ code: 'DENIED', message: 'denied' }, 403) : response({ current: { version: 1 }, versions: [] }));
  await client.history({ entityType: 'calendar_event', entityId: 'a' }); denied = true;
  await assert.rejects(client.history({ entityType: 'calendar_event', entityId: 'a' }), error => error.status === 403 && error.code === 'DENIED');
});
test('restore merges only its entity into latest state and does not skip unrelated pull revisions', async () => {
  let live;
  const change = { entityType: 'calendar_event', entityId: 'a', payload: event('a', 'restored'), version: 3, revision: 42 };
  const { client, workspace } = await fixture(async () => { live.events.push(event('added-during-request')); return response({ restored: true, change }); });
  live = clone(workspace);
  const result = await client.restoreHistory({ entityType: 'calendar_event', entityId: 'a', historyId: 'old', expectedVersion: 2 }, {
    getWorkspace: () => live, applyWorkspace: next => { live = next; },
  });
  assert.equal(result.change.version, 3);
  assert.equal(live.events.find(item => item.id === 'a').content, 'restored');
  assert.ok(live.events.some(item => item.id === 'added-during-request'));
  assert.equal(client.state.cursor, 10);
  assert.equal(client.state.versions['calendar_event::a'], 3);
  await client.captureWorkspace(live);
  assert.equal(client.state.queue.length, 1); // Only the independent new event remains to upload.
  assert.equal(client.state.queue[0].entityId, 'added-during-request');
});
test('lost restore replies reuse immutable operation ID and device identity', async () => {
  const requests = []; let fail = true;
  const { client, workspace } = await fixture(async (url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (fail) { fail = false; throw Error('receipt lost'); }
    return response({ restored: true, change: { entityType: 'calendar_event', entityId: 'a', payload: event('a', 'restored'), version: 2, revision: 11 } });
  });
  const input = { entityType: 'calendar_event', entityId: 'a', historyId: 'old', expectedVersion: 1 };
  await assert.rejects(client.restoreHistory(input), /receipt lost/);
  client.state.deviceId = 'new-device';
  await client.restoreHistory(input, { getWorkspace: () => workspace });
  assert.equal(requests[0].opId, requests[1].opId);
  assert.equal(requests[0].deviceId, requests[1].deviceId);
});
test('pending local edits prevent a restore from silently discarding its queue', async () => {
  let calls = 0;
  const { client, workspace } = await fixture(async () => { calls++; return response({}); });
  workspace.events[0].content = 'unsynced';
  await client.captureWorkspace(workspace);
  await assert.rejects(client.restoreHistory({ entityType: 'calendar_event', entityId: 'a', historyId: 'old', expectedVersion: 1 }), error => error.code === 'LOCAL_PENDING');
  assert.equal(client.state.queue[0].payload.content, 'unsynced');
  assert.equal(calls, 0);
});
test('expired restore preview returns a version conflict without changing local content', async () => {
  const { client, workspace } = await fixture(async () => response({ code: 'VERSION_CONFLICT', message: 'changed' }, 409));
  let applied = false;
  await assert.rejects(client.restoreHistory({ entityType: 'calendar_event', entityId: 'a', historyId: 'old', expectedVersion: 1 }, {
    getWorkspace: () => workspace, applyWorkspace: () => { applied = true; },
  }), error => error.status === 409 && error.code === 'VERSION_CONFLICT');
  assert.equal(applied, false); assert.equal(workspace.events[0].content, 'a');
});


test('retrying an old restore receipt cannot rewind a newer downloaded version', async () => {
  let loseReceipt = true;
  const older = { entityType: 'calendar_event', entityId: 'a', payload: event('a', 'restored earlier'), version: 3, revision: 12 };
  const latest = { ...older, payload: event('a', 'edited after restoration'), version: 5, revision: 20 };
  const { client, workspace } = await fixture(async url => {
    if (url.endsWith('/history/restore')) {
      if (loseReceipt) { loseReceipt = false; throw Error('receipt lost'); }
      return response({ restored: true, change: older });
    }
    return response({ current: latest, versions: [older] });
  });
  const input = { entityType: 'calendar_event', entityId: 'a', historyId: 'previous', expectedVersion: 2 };
  await assert.rejects(client.restoreHistory(input), /receipt lost/);
  let live = W.applyEntityChange(workspace, latest);
  client.state.versions['calendar_event::a'] = 5;
  const result = await client.restoreHistory(input, { getWorkspace: () => live, applyWorkspace: next => { live = next; } });
  assert.equal(result.superseded, true);
  assert.equal(live.events[0].content, 'edited after restoration');
  assert.equal(client.state.versions['calendar_event::a'], 5);
});


test('duplicate restore broadcasts and acknowledgements preserve edits typed after the restore', () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  let current = W.createEmptyWorkspace('2026-11-01'); current.events = [event('a', 'before')];
  const base = clone(current), events = [];
  const context = vm.createContext({ TabOutWorkspaceSync: W, chrome: { runtime: { onMessage: { addListener() {} } } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    dispatchEvent(value) { events.push(value.type); } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../shared/workspace-browser-client.js'), 'utf8'), context);
  const client = new context.TabOutWorkspaceBrowserClient({ config: {}, onStatus() {}, baseline: base,
    getWorkspace: () => current, applyWorkspace: next => { current = next; } });
  const envelope = { revision: 1, ownerId: 'uid:one', workspace: base, state: { accountId: 'uid:one' }, rawState: {} };
  client.receive(envelope);
  const change = { entityType: 'calendar_event', entityId: 'a', payload: event('a', 'restored'), version: 2, revision: 9 };
  const restoredWorkspace = W.applyEntityChange(base, change);
  client.receive({ ...envelope, revision: 2, workspace: restoredWorkspace, restoredChange: change });
  assert.equal(current.events[0].content, 'restored');
  current.events[0].content = 'typed after restoration';
  client.receive({ ...envelope, revision: 2, workspace: restoredWorkspace, restoredChange: change });
  assert.equal(current.events[0].content, 'typed after restoration');
  assert.deepEqual(events, ['inner-garden-record-restoring', 'inner-garden-record-restored']);
  client.receive({ ...envelope, revision: 3, ownerId: 'uid:two', state: { accountId: 'uid:two' }, workspace: restoredWorkspace, restoredChange: { ...change, version: 3 } });
  assert.equal(events.length, 2, 'account switch must not attribute the previous account draft to the new owner');
});


test('copied legacy device IDs get independent installation identities without rewriting sent operations', async () => {
  const { workerHarness } = require('./worker-harness.cjs');
  const namespace = 'dk-checkin-d8gw6jhrt5b2ced62';
  const workspace = W.createEmptyWorkspace('2026-11-01');
  workspace.events = [event('a')];
  const operation = { opId: 'already-sent', entityKey: 'calendar_event::a', entityType: 'calendar_event', entityId: 'a',
    deviceId: 'copied-device', baseVersion: 0, action: 'upsert', payload: event('a'), sent: true, clientModifiedAt: '2026-11-01T01:00:00Z' };
  const input = { weeklyWorkspace: workspace, ['tabOutSyncState:' + namespace]: {
    deviceId: 'copied-device', seeded: true, baseline: W.workspaceToEntityMap(workspace), queue: [operation],
  } };
  const chrome = workerHarness(input, { enabled: false }), ego = workerHarness(input, { enabled: false });
  const a = await chrome.request({ method: 'initialize' }), b = await ego.request({ method: 'initialize' });
  assert.notEqual(a.state.deviceId, b.state.deviceId);
  assert.notEqual(a.state.deviceId, 'copied-device');
  assert.equal(chrome.data['tabOutSyncState:' + namespace].queue[0].deviceId, 'copied-device');
  assert.equal(chrome.data['tabOutSyncState:' + namespace].queue[0].opId, 'already-sent');
  const restarted = workerHarness(chrome.data, { enabled: false });
  assert.equal((await restarted.request({ method: 'initialize' })).state.deviceId, a.state.deviceId);
});
