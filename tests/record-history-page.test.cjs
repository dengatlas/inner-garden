const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../extension/record-history');
const clone = value => JSON.parse(JSON.stringify(value));
const snapshot = (version, content, extra = {}) => ({
  entityType: 'calendar_event', entityId: 'record-one', version, historyId: `history-${version}`,
  payload: { id: 'record-one', dateKey: '2026-11-01', startMinute: 540, endMinute: 600, title: '时间块', content, color: 'white' },
  clientModifiedAt: '2026-11-01T01:00:00Z', ...extra,
});

function harness(client = {}) {
  let dialog, activeAccount = 'uid:one', confirmCount = 0;
  const copied = [], restored = [], beforeRestore = [], documentListeners = {}, runtimeListeners = [];
  const context = vm.createContext({
    console, Intl, Date, Uint32Array,
    document: {
      activeElement: { isConnected: true, focus() {} },
      body: { append(value) { dialog = value; } },
      createElement() { return { listeners: {}, innerHTML: '', setAttribute() {}, addEventListener(name, fn) { this.listeners[name] = fn; }, showModal() {}, close() {}, remove() { this.removed = true; } }; },
      addEventListener(name, fn) { documentListeners[name] = fn; }, removeEventListener(name) { delete documentListeners[name]; },
    },
    navigator: { onLine: true, clipboard: { async writeText(value) { copied.push(value); } } },
    window: { confirm() { confirmCount++; return true; } },
    chrome: { runtime: { onMessage: { addListener(fn) { runtimeListeners.push(fn); }, removeListener(fn) { runtimeListeners.splice(runtimeListeners.indexOf(fn), 1); } } } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/record-history.js'), 'utf8'), context);
  const calls = [];
  const api = {
    getPublicState: () => ({ accountId: activeAccount }),
    history: async input => { calls.push(input); return { current: snapshot(3, 'new'), versions: [snapshot(2, 'old'), snapshot(1, 'first')] }; },
    historyChanges: async () => ({ items: [], nextCursor: null }),
    restoreHistory: async input => { restored.push(input); return { change: snapshot(4, 'old') }; },
    ...client,
  };
  const options = { client: api, entityType: 'calendar_event', entityId: 'record-one', onBeforeRestore: target => beforeRestore.push(target.entityId) };
  return {
    context, copied, restored, beforeRestore, calls,
    open: additions => context.InnerGardenRecordHistory.open({ ...options, ...additions }),
    html: () => dialog.innerHTML,
    changeAccount: value => { activeAccount = value; for (const fn of [...runtimeListeners]) fn({ channel: 'tab-out-workspace-update' }); },
    confirmCount: () => confirmCount,
    removed: () => dialog.removed,
    async click(op, index) { dialog.listeners.click({ target: { closest: () => ({ disabled: false, dataset: { rhOp: op, index: String(index) } }) } }); await new Promise(setImmediate); },
  };
}

test('comparison distinguishes moved date, time, title, color and deleted state', () => {
  const previous = snapshot(1, 'same'), current = snapshot(2, 'same');
  Object.assign(current.payload, { dateKey: '2026-11-02', startMinute: 600, title: 'revised', color: 'pink' });
  current.deletedAt = '2026-11-02T00:00:00Z';
  const rows = H.metadata(current, previous, 'calendar_event');
  assert.deepEqual(rows.map(row => row.key), ['dateKey', 'startMinute', 'title', 'color', 'deleted']);
  assert.equal(rows[1].current, '10:00');
  assert.equal(H.summary(current, previous, 'calendar_event'), '已删除');
  current.deletedAt = null;
  assert.equal(H.summary(current, previous, 'calendar_event'), '日期由 2026-11-01 改为 2026-11-02');
});

test('line comparison preserves repeated unchanged lines and identifies removed text', () => {
  const diff = H.lineDiff('same\nnew\nsame\nend', 'same\nold\nsame\nend');
  assert.deepEqual(diff.current.filter(line => line.changed).map(line => line.text), ['new']);
  assert.deepEqual(diff.previous.filter(line => line.changed).map(line => line.text), ['old']);
  assert.equal(diff.bounded, false);
  assert.equal(H.lineDiff('x\n'.repeat(401), 'y\n'.repeat(401)).bounded, true);
});

test('viewing and copying an old version never calls restore or submits edits', async () => {
  const page = harness();
  await page.open({ localEntity: snapshot(3, '<local edit>') });
  assert.match(page.html(), /&lt;local edit&gt;/);
  await page.click('select', 1);
  await page.click('copy');
  assert.match(page.copied[0], /old$/);
  assert.deepEqual(page.restored, []);
  assert.deepEqual(page.beforeRestore, []);
  assert.equal(page.confirmCount(), 0);
});

test('restore preserves draft first and sends the previewed cloud version as precondition', async () => {
  const page = harness();
  let applied;
  await page.open({ onRestored: result => { applied = result.change.version; } });
  await page.click('select', 2);
  await page.click('restore');
  assert.deepEqual(page.beforeRestore, ['record-one']);
  assert.deepEqual(clone(page.restored), [{ entityType: 'calendar_event', entityId: 'record-one', historyId: 'history-1', expectedVersion: 3 }]);
  assert.equal(applied, 4);
  assert.equal(page.confirmCount(), 1);
  assert.equal(page.removed(), true);
});

test('stale restore refreshes comparison and never applies a successful restore callback', async () => {
  let reads = 0, applied = false;
  const page = harness({
    history: async () => ({ current: snapshot(++reads + 2, 'latest'), versions: [snapshot(1, 'old')] }),
    restoreHistory: async () => { throw Object.assign(new Error('changed'), { status: 409 }); },
  });
  await page.open({ onRestored: () => { applied = true; } });
  await page.click('select', 1);
  await page.click('restore');
  assert.equal(reads, 2);
  assert.equal(applied, false);
  assert.match(page.html(), /已刷新比较/);
  assert.equal(page.removed(), undefined);
});

test('account switch blocks restoring or copying the previously opened account record', async () => {
  const page = harness();
  await page.open();
  await page.click('select', 1);
  page.changeAccount('uid:two');
  await page.click('restore');
  await page.click('copy');
  assert.deepEqual(page.restored, []);
  assert.deepEqual(page.copied, []);
  assert.match(page.html(), /账号已切换/);
});

test('offline cached history remains copyable and recovery remains disabled', async () => {
  const page = harness({ history: async () => ({ cached: true, current: snapshot(2, 'new'), versions: [snapshot(1, 'old')] }) });
  page.context.navigator.onLine = false;
  await page.open(); await page.click('select', 1); await page.click('copy'); await page.click('restore');
  assert.equal(page.copied.length, 1);
  assert.deepEqual(page.restored, []);
  assert.match(page.html(), /请联网后恢复/);
});

test('locally retained recovery draft is viewable and copyable without a cloud restore', async () => {
  const page = harness();
  await page.open({ localDraft: snapshot(0, 'unsent local text', { historyId: undefined }) });
  await page.click('select', -1); await page.click('copy'); await page.click('restore');
  assert.match(page.copied[0], /unsent local text$/);
  assert.deepEqual(page.restored, []);
});

test('expired day pagination clears its cursor and replaces stale items with a fresh first page', async () => {
  const requests = [];
  const dayItem = title => ({ entityType: 'calendar_event', entityId: title, current: snapshot(1, '', { payload: { ...snapshot(1, '').payload, title } }) });
  const page = harness({ historyChanges: async input => {
    requests.push(clone(input));
    if (requests.length === 1) return { items: [dayItem('stale item')], nextCursor: 'old-generation' };
    if (input.cursor) throw Object.assign(new Error('changed during pagination'), { status: 409, code: 'HISTORY_CURSOR_STALE' });
    return { items: [dayItem('fresh item')], nextCursor: null };
  } });
  await page.open({ entityId: undefined, dateKey: '2026-11-01' });
  assert.match(page.html(), /stale item/);
  await page.click('more');
  assert.deepEqual(requests, [{ dateKey: '2026-11-01' }, { dateKey: '2026-11-01', cursor: 'old-generation' }, { dateKey: '2026-11-01' }]);
  assert.doesNotMatch(page.html(), /stale item|加载更多/);
  assert.match(page.html(), /fresh item/);
  assert.match(page.html(), /已刷新列表/);
});

test('account transition immediately removes former account history and local draft from the page', async () => {
  const page = harness();
  await page.open({ localEntity: snapshot(3, 'PRIVATE CURRENT'), localDraft: snapshot(0, 'PRIVATE DRAFT') });
  assert.match(page.html(), /PRIVATE CURRENT/);
  page.changeAccount('uid:two');
  assert.doesNotMatch(page.html(), /PRIVATE CURRENT|PRIVATE DRAFT|上一个版本/);
  assert.match(page.html(), /账号已切换/);
  await page.click('select', 1);
  assert.doesNotMatch(page.html(), /PRIVATE CURRENT|PRIVATE DRAFT/);
  assert.deepEqual(page.restored, []);
});

function appHistoryHarness() {
  const W = require('../shared/workspace-sync');
  const workspace = W.createEmptyWorkspace('2026-11-01');
  workspace.events = [snapshot(1, 'local edit').payload, { ...snapshot(1, 'independent').payload, id: 'independent' }];
  workspace.logs['2026-11-01'] = { action: 'keep daily content' };
  const drafts = new Map(), cleared = [], captured = [], events = {}, editors = {}, toasts = [];
  const context = vm.createContext({
    weeklyWorkspaceState: workspace,
    workspaceSyncClient: { getPublicState: () => ({ accountId: 'uid:one' }) },
    TabOutWorkspaceSync: W,
    InnerGardenRecordHistory: { async open(options) { captured.push(options); } },
    getPersistedWeeklyWorkspaceState: () => context.weeklyWorkspaceState,
    getSelectedDailyLogDateKey: () => '2026-11-01',
    document: { querySelectorAll: () => [], getElementById: id => editors[id] || null },
    window: { addEventListener(name, handler) { events[name] = handler; } },
    localStorage: { getItem: key => drafts.get(key), setItem: (key, value) => drafts.set(key, value) },
    pendingDailyLogGeneratedSync: { dateKey: '2026-11-01', text: 'pending summary with old linked events' },
    dailyLogGeneratedSyncTimer: 42,
    clearTimeout: id => cleared.push(id),
    getWeekEvent: id => context.weeklyWorkspaceState.events.find(item => item.id === id),
    getWeekEventLabel: record => `${record.dateKey} ${record.title}`,
    getDailyLogFieldValue: (field, dateKey) => context.weeklyWorkspaceState.logs[dateKey]?.[field] || '',
    setDailyLogEditorSyncStatus() {},
    closeWeekEntryEditor() {},
    renderWeekCalendar() {}, renderWeekPlan() {}, renderDailyLogPanel() {}, renderDailyLogArchive() {}, renderYearArchive() {}, showToast: message => toasts.push(message),
  });
  const app = fs.readFileSync(path.join(__dirname, '../extension/app.js'), 'utf8');
  vm.runInContext(app.slice(app.indexOf('function recordHistoryEntity('), app.indexOf('function getDailyLogFieldKeyFromTarget(')), context);
  return { context, drafts, cleared, captured, events, editors, toasts, W };
}

test('restoring a time block suspends linked generated-summary rewrites and preserves both local drafts', async () => {
  const page = appHistoryHarness();
  await page.context.openRecordHistory('calendar_event', 'record-one');
  assert.equal(page.context.dailyLogGeneratedSyncTimer, 42, 'browsing alone must not stop or submit editing');
  const options = page.captured[0];
  options.onBeforeRestore(options);
  assert.equal(page.context.pendingDailyLogGeneratedSync, null);
  assert.equal(page.context.dailyLogGeneratedSyncTimer, null);
  assert.deepEqual(page.cleared, [42]);
  assert.equal(JSON.parse(page.drafts.get('innerGardenRecordHistoryDraft:uid:one:calendar_event:record-one')).payload.content, 'local edit');
  assert.equal(JSON.parse(page.drafts.get('innerGardenRecordHistoryDraft:uid:one:daily_log_field:2026-11-01|generated')).payload.value, 'pending summary with old linked events');
  await options.onRestored({ change: snapshot(2, 'restored content') }, options);
  assert.equal(page.context.weeklyWorkspaceState.events.find(event => event.id === 'record-one').content, 'restored content');
  assert.equal(page.context.weeklyWorkspaceState.events.find(event => event.id === 'independent').content, 'independent');
  assert.equal(page.context.weeklyWorkspaceState.logs['2026-11-01'].action, 'keep daily content');
});

test('restoring one day does not cancel a generated draft belonging to another day', () => {
  const page = appHistoryHarness();
  page.context.pendingDailyLogGeneratedSync = { dateKey: '2026-11-02', text: 'different day draft' };
  page.context.prepareRecordHistoryRestore({ entityType: 'calendar_event', entityId: 'record-one', dateKey: '2026-11-01' });
  assert.equal(page.context.pendingDailyLogGeneratedSync.text, 'different day draft');
  assert.equal(page.context.dailyLogGeneratedSyncTimer, 42);
  assert.deepEqual(page.cleared, []);
});

test('another desktop page preserves its field draft and refreshes the old expanded textarea after restore', () => {
  const page = appHistoryHarness();
  const expanded = { dataset: { logDateKey: '2026-11-01', logEditorKey: 'action' }, value: 'keep daily content' };
  page.editors.dailyLogEditor = { classList: { contains: () => true }, querySelector: () => expanded };
  const change = { entityType: 'daily_log_field', entityId: '2026-11-01|action', payload: { dateKey: '2026-11-01', field: 'action', value: 'restored field' }, version: 4, revision: 8 };
  page.events['inner-garden-record-restoring']({ detail: change });
  assert.equal(JSON.parse(page.drafts.get('innerGardenRecordHistoryDraft:uid:one:daily_log_field:2026-11-01|action')).payload.value, 'keep daily content');
  page.context.weeklyWorkspaceState = page.W.applyEntityChange(page.context.weeklyWorkspaceState, change);
  page.events['inner-garden-record-restored']({ detail: change });
  assert.equal(expanded.value, 'restored field', 'switching dates must no longer read the superseded textarea');
  assert.equal(page.context.pendingDailyLogGeneratedSync, null);
  assert.equal(page.context.weeklyWorkspaceState.events.find(item => item.id === 'independent').content, 'independent');
});

test('restore broadcast and acknowledgement cannot overwrite its saved draft or subsequent edits twice', () => {
  const page = appHistoryHarness();
  const title = { dataset: { eventId: 'record-one' }, value: '时间块' }, expanded = { value: 'local edit' }, heading = { textContent: '' };
  page.editors.weekEntryEditor = {
    classList: { contains: () => true },
    querySelector: key => ({ '#weekEventTitleInput': title, '#weekEntryExpanded': expanded, '#weekEditorTitle': heading }[key]),
    querySelectorAll: () => [],
  };
  const change = snapshot(4, 'restored text', { revision: 8 });
  page.events['inner-garden-record-restoring']({ detail: change });
  page.events['inner-garden-record-restored']({ detail: change });
  assert.equal(expanded.value, 'restored text');
  page.context.weeklyWorkspaceState.events.find(item => item.id === 'record-one').content = 'new edit after restore';
  expanded.value = 'new edit after restore';
  page.events['inner-garden-record-restoring']({ detail: change });
  page.events['inner-garden-record-restored']({ detail: change });
  assert.equal(expanded.value, 'new edit after restore');
  assert.equal(page.context.weeklyWorkspaceState.events.find(item => item.id === 'record-one').content, 'new edit after restore');
  assert.equal(JSON.parse(page.drafts.get('innerGardenRecordHistoryDraft:uid:one:calendar_event:record-one')).payload.content, 'local edit');
});

test('cross-page restore keeps a volatile local draft if persistent draft storage is full', () => {
  const page = appHistoryHarness();
  page.context.localStorage.setItem = () => { throw new Error('quota'); };
  const change = snapshot(4, 'restored text', { revision: 8 });
  page.events['inner-garden-record-restoring']({ detail: change });
  page.events['inner-garden-record-restored']({ detail: change });
  assert.equal(page.context.readRecordHistoryDraft('calendar_event', 'record-one').payload.content, 'local edit');
  assert.equal(page.context.readRecordHistoryDraft('daily_log_field', '2026-11-01|generated').payload.value, 'pending summary with old linked events');
  assert.equal(page.context.pendingDailyLogGeneratedSync, null);
  assert.match(page.toasts[0], /此页面/);
  assert.equal(page.context.weeklyWorkspaceState.events.find(item => item.id === 'record-one').content, 'restored text');
});

test('unrelated entity notifications do not change editors or stop pending work', () => {
  const page = appHistoryHarness();
  const before = JSON.stringify(page.context.weeklyWorkspaceState);
  const change = { entityType: 'focus_session', entityId: 'focus-one', payload: { id: 'focus-one' }, version: 1 };
  page.events['inner-garden-record-restoring']({ detail: change });
  page.events['inner-garden-record-restored']({ detail: change });
  assert.equal(JSON.stringify(page.context.weeklyWorkspaceState), before);
  assert.equal(page.context.dailyLogGeneratedSyncTimer, 42);
  assert.equal(page.drafts.size, 0);
});
