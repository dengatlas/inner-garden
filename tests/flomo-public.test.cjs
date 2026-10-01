const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../shared/flomo');
const S = require('../shared/flomo-prompt-seed');
const T = require('../shared/flomo-transport');
const V = require('../extension/local-favicon');
const { workerHarness } = require('./worker-harness.cjs');
const note = () => ({ id: 'memo-test', body: 'synthetic note', tagIds: [], inlineTagIds: [], createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z', pinned: false, deletedAt: null, images: ['data:image/png;base64,AA=='] });

test('public prompt seed creates no unverified notes and never removes existing notes', () => {
  const state = F.empty(); state.notes.push(note()); state.promptSeedVersion = 1;
  assert.equal(S.apply(state), true); assert.equal(S.apply(state), false);
  assert.equal(S.entries.length, 0); assert.equal(state.notes[0].body, 'synthetic note');
});

test('flomo portable export excludes images and unsaved drafts', () => {
  const state = F.empty(); state.notes.push(note()); state.draft = { body: 'private draft' };
  const portable = F.portable(state);
  assert.equal(portable.draft, undefined); assert.equal(portable.notes[0].images, undefined);
  assert.equal(portable.notes[0].attachmentCount, 1);
});

test('permanent deletion cannot be resurrected by importing an older snapshot', () => {
  const state = F.empty(); const old = note(); old.deletedAt = old.updatedAt; state.notes.push(old);
  const purged = F.purge(state, [old.id]);
  const restored = F.mergeImport(purged, F.portable(state)).state;
  assert.equal(restored.notes.find(n => n.id === old.id).body, '');
  assert.ok(restored.notes.find(n => n.id === old.id).purgedAt);
});

test('large Unicode text round-trips without splitting a surrogate pair', () => {
  const source = 'a'.repeat(T.CHUNK - 1) + '🌱中文'.repeat(2000);
  const chunks = T.splitText(source);
  assert.equal(chunks.join(''), source);
  for (const chunk of chunks.slice(0, -1)) assert.equal(/[\uD800-\uDBFF]$/.test(chunk), false);
});

test('chunked push uses the actual committed server snapshot', async () => {
  const sent = [], committed = { version: 1, notes: [{ id: 'server-tombstone', purgedAt: 'stamp' }], tags: [] };
  const result = await T.exchange(async (action, input) => {
    sent.push(action);
    if (action === 'push') return { snapshotId: 's1', parts: 1, revision: 2 };
    if (action === 'read-part') return { index: input.index, content: JSON.stringify(committed) };
    return {};
  }, 'push', { opId: 'op1', baseRevision: 1, state: { version: 1, notes: [], tags: [] } });
  assert.deepEqual(sent, ['push-part', 'push', 'read-part']); assert.deepEqual(result.state, committed);
});

test('local icons never insert domain markup or external resources', () => {
  const markup = V.markup('<img src="https://tracker.test" onerror="alert(1)">');
  assert.equal(/https?:|onerror|<img|tracker/.test(markup), false);
  assert.match(V.markup('example.com'), />E<\/text>/);
});

test('background can save local notes without login or cloud requests', async () => {
  const worker = workerHarness();
  const result = await worker.message({ channel: 'inner-garden-flomo-request', method: 'save', owner: '', note: { body: 'local #记录' } });
  assert.equal(result.ok, true); assert.equal(result.result.notes[0].body, 'local #记录');
  assert.equal(worker.requests.length, 0);
});
