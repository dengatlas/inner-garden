const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function pageHarness(client = {}) {
  let now = 1000, nextTimer = 0;
  const timers = new Map(), listeners = {}, payloads = [], html = [];
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    document: { getElementById: () => ({ open: true }), addEventListener: (name, fn) => { listeners[name] = fn; } },
    window: { addEventListener() {} },
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    workspaceAccountLoginMethod: 'phone-device', workspaceAccountView: 'add-account',
    workspaceSyncClient: { cancelDeviceLogin: async () => {}, ...client },
    getWorkspaceSyncConfig: () => ({ environmentId: 'test-env' }),
    qrcodegen: { QrCode: { Ecc: { MEDIUM: 1 }, encodeText: value => { payloads.push(JSON.parse(value)); return { size: 1, getModule: () => false }; } } },
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    renderAccountFeedback: (title, detail) => `${title}: ${detail}`,
    renderWorkspaceSyncDialog: () => html.push(context.renderDeviceLoginPanel()),
    ensureWorkspaceSyncHostPermission: async () => true,
    flushWeeklyWorkspaceSave: async () => {}, performWorkspaceSync: async () => {}, showToast() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/device-login.js'), 'utf8'), context);
  const setChallenge = challenge => { context.testChallenge = challenge; vm.runInContext('workspaceDeviceLogin = testChallenge', context); };
  const state = () => JSON.parse(vm.runInContext('JSON.stringify(workspaceDeviceLogin)', context));
  const click = async action => listeners.click({ target: { closest: () => ({ dataset: { action }, disabled: false }) } });
  const tick = async () => { const [id, timer] = timers.entries().next().value; timers.delete(id); await timer.fn(); };
  return { context, timers, payloads, html, setChallenge, state, click, tick, advance: milliseconds => { now += milliseconds; } };
}

function waiting(overrides = {}) {
  return { id: 'challenge-one', status: 'waiting', expiresAt: 301000, intervalMs: 5000, userCode: 'Mixed_Code-09+/=', ...overrides };
}

test('QR protocol preserves opaque codes and the waiting page directs users to scan only', () => {
  const page = pageHarness();
  page.setChallenge(waiting());
  const rendered = page.context.renderDeviceLoginPanel();
  assert.deepEqual(page.payloads[0], { protocol: 'inner-garden-device-login-v1', environmentId: 'test-env', userCode: 'Mixed_Code-09+/=' });
  assert.match(rendered, /扫描这个二维码/);
  assert.doesNotMatch(rendered, /输入编号/);
});

test('QR optionally transmits only the server-issued scope without changing protocol or case', () => {
  const page = pageHarness();
  page.setChallenge(waiting({ scope: 'user sso' }));
  page.context.renderDeviceLoginPanel();
  assert.deepEqual(page.payloads[0], { protocol: 'inner-garden-device-login-v1', environmentId: 'test-env',
    userCode: 'Mixed_Code-09+/=', scope: 'user sso' });
});

test('authorized access-only preview derives session lifetime and requires renewed phone authorization', () => {
  const page = pageHarness();
  page.setChallenge(waiting({ status: 'authorized', userId: 'phone-uid', label: 'Phone account', accessOnly: true,
    sessionExpiresAt: 5401000, sessionExpiresIn: 5400 }));
  let rendered = page.context.renderDeviceLoginPanel();
  assert.match(rendered, /账号 UID.*phone-uid/);
  assert.match(rendered, /本次访问授权剩余约 1小时30分钟/);
  assert.match(rendered, /到期后需重新使用手机授权登录/);
  assert.doesNotMatch(rendered, /10 天|10天|<svg/);
  page.advance(61000);
  rendered = page.context.renderDeviceLoginPanel();
  assert.match(rendered, /1小时28分钟59秒/);
  page.advance(5400000);
  rendered = page.context.renderDeviceLoginPanel();
  assert.doesNotMatch(rendered, /data-action="confirm-device-login"/);
  assert.match(rendered, /授权已过期/);
});

test('expired QR disappears and requires explicit regeneration without requesting a replacement', async () => {
  let polls = 0, starts = 0, cancellations = 0;
  const page = pageHarness({ pollDeviceLogin: async () => { polls++; }, startDeviceLogin: async () => { starts++; }, cancelDeviceLogin: async () => { cancellations++; } });
  page.setChallenge(waiting({ expiresAt: 4000 }));
  page.context.scheduleDeviceLoginPoll(0);
  assert.equal([...page.timers.values()][0].delay, 5000);
  page.advance(5000);
  await page.tick();
  assert.equal(page.state().status, 'expired');
  assert.equal(polls, 0); assert.equal(starts, 0); assert.equal(cancellations, 1);
  assert.equal(page.timers.size, 0);
  assert.doesNotMatch(page.html.at(-1), /<svg/);
  assert.match(page.html.at(-1), /重新生成授权二维码.*重新扫码/);
});

test('transient polling errors retain the same challenge and sanitized diagnostics at five seconds', async () => {
  const page = pageHarness({ pollDeviceLogin: async () => { throw Object.assign(new Error('PRIVATE-ACCESS user_code=SECRET (503)'), { authErrorCode: 'INTERNAL_ERROR' }); } });
  page.setChallenge(waiting());
  page.context.scheduleDeviceLoginPoll(0);
  await page.tick();
  assert.equal(page.state().id, 'challenge-one');
  assert.equal(page.state().userCode, 'Mixed_Code-09+/=');
  assert.equal([...page.timers.values()][0].delay, 5000);
  assert.match(page.html.at(-1), /查询手机授权结果失败.*HTTP 503.*INTERNAL_ERROR/);
  assert.doesNotMatch(page.html.at(-1), /PRIVATE|SECRET|user_code/);
});

test('profile failure hides the consumed QR and permits explicit generation of a new challenge', async () => {
  let starts = 0;
  const page = pageHarness({
    pollDeviceLogin: async () => { throw Object.assign(new Error('无法核对授权账号，请重新生成二维码并授权。（HTTP 503）'), { authErrorCode: 'DEVICE_PROFILE_LOOKUP_FAILED' }); },
    startDeviceLogin: async () => { starts++; return waiting({ id: 'challenge-two' }); },
  });
  page.setChallenge(waiting());
  page.context.scheduleDeviceLoginPoll(0);
  await page.tick();
  assert.equal(page.state().status, 'failed');
  assert.doesNotMatch(page.html.at(-1), /<svg/);
  assert.equal(page.timers.size, 0);
  assert.equal(starts, 0);
  await page.click('start-device-login');
  assert.equal(starts, 1);
  assert.equal(page.state().id, 'challenge-two');
  assert.match(page.html.at(-1), /<svg/);
});

test('cancelled pages ignore late polling errors and never resume a stale timer', async () => {
  let fail;
  const page = pageHarness({ pollDeviceLogin: () => new Promise((_resolve, reject) => { fail = reject; }) });
  page.setChallenge(waiting());
  page.context.scheduleDeviceLoginPoll(0);
  const pending = page.tick();
  await page.click('cancel-device-login');
  fail(new Error('late secret'));
  await pending;
  assert.equal(page.state(), null);
  assert.equal(page.timers.size, 0);
  assert.doesNotMatch(page.html.at(-1), /late secret/);
});
