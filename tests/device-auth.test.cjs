const test = require('node:test');
const assert = require('node:assert/strict');
const { DeviceAuthorization, GRANT_TYPE } = require('../shared/device-auth');
function fixture(overrides = {}) {
  let time = 1000, n = 0;
  const calls = [];
  const flow = new DeviceAuthorization({ clientId: 'test-env', now: () => time, createId: () => `challenge-${++n}`,
    request: async (path, options) => {
      calls.push({ path, options });
      if (overrides.request) return overrides.request(path, options);
      if (path.endsWith('/device/code')) return { device_code: 'PRIVATE-DEVICE', user_code: 'ABCD-EFGH', expires_in: 300, interval: 5 };
      if (path.endsWith('/token')) return { access_token: 'PRIVATE-ACCESS', refresh_token: 'PRIVATE-REFRESH', sub: 'retained-uid' };
      return { sub: 'retained-uid', name: 'Same nickname' };
    } });
  return { flow, calls, advance: n => { time += n; } };
}
test('device challenge and authorized preview contain no credentials; adopting requires exact UID', async () => {
  const { flow, calls } = fixture();
  const started = await flow.start('');
  assert.equal(started.status, 'waiting');
  const result = await flow.poll(started.id, '');
  assert.equal(result.userId, 'retained-uid');
  assert.equal(result.status, 'authorized');
  assert.doesNotMatch(JSON.stringify([started, result]), /PRIVATE|deviceCode|access_token|refresh_token/);
  assert.equal(calls[1].options.body.grant_type, GRANT_TYPE);
  assert.equal(calls[2].options.accessToken, 'PRIVATE-ACCESS');
  assert.throws(() => flow.consume(started.id, '', 'different-uid'), /核对/);
  const session = flow.consume(started.id, '', result.userId);
  assert.equal(session.session.sub, 'retained-uid');
  assert.throws(() => flow.consume(started.id, '', result.userId), /核对/);
});
test('cancelled in-flight grant and account switch cannot expose or adopt a returned session', async () => {
  let release;
  const { flow } = fixture({ request: async path => {
    if (path.endsWith('/device/code')) return { device_code: 'PRIVATE', user_code: 'ABCD-EFGH', expires_in: 300 };
    return new Promise(resolve => { release = resolve; });
  } });
  const c = await flow.start('uid:original');
  assert.deepEqual(await flow.poll(c.id, 'uid:other'), { status: 'expired' });
  const pending = flow.poll(c.id, 'uid:original');
  flow.cancel(); release({ access_token: 'PRIVATE', refresh_token: 'PRIVATE' });
  assert.deepEqual(await pending, { status: 'expired' });
});
test('pending and slow-down respect server interval; expired challenges stop network requests', async () => {
  let status = 'authorization_pending';
  const { flow, calls, advance } = fixture({ request: async path => {
    if (path.endsWith('/device/code')) return { device_code: 'PRIVATE', user_code: 'ABCD-EFGH', expires_in: 300, interval: 5 };
    const error = new Error('not ready'); error.authErrorData = { error: status }; throw error;
  } });
  const c = await flow.start('');
  assert.equal((await flow.poll(c.id, '')).status, 'waiting');
  await flow.poll(c.id, ''); assert.equal(calls.length, 2);
  advance(5000); status = 'slow_down'; assert.equal((await flow.poll(c.id, '')).intervalMs, 10000);
  advance(5000); await flow.poll(c.id, ''); assert.equal(calls.length, 3);
  advance(300000); assert.deepEqual(await flow.poll(c.id, ''), { status: 'expired' });
  assert.equal(calls.length, 3);
});
test('profile must match the newly issued session UID before account confirmation', async () => {
  const { flow } = fixture({ request: async path => path.endsWith('/device/code')
    ? { device_code: 'PRIVATE', user_code: 'ABCD-EFGH', expires_in: 300 }
    : path.endsWith('/token') ? { access_token: 'PRIVATE', refresh_token: 'PRIVATE', sub: 'one' }
      : { sub: 'another', name: 'Same nickname' } });
  const c = await flow.start('');
  await assert.rejects(flow.poll(c.id, ''), /不一致/);
  assert.equal(flow.challenge, null);
});
test('older start results cannot replace a newer challenge', async () => {
  let release;
  const { flow } = fixture({ request: () => new Promise(resolve => { release = resolve; }) });
  const old = flow.start(''); const first = release;
  const next = flow.start('');
  first({ device_code: 'OLD', user_code: 'OLD-CODE', expires_in: 300 });
  assert.deepEqual(await old, { status: 'cancelled' });
  release({ device_code: 'NEW', user_code: 'NEW-CODE', expires_in: 300 });
  assert.equal((await next).userCode, 'NEW-CODE');
});

test('failed profile lookup discards a consumed grant instead of polling it again', async () => {
  const { flow } = fixture({ request: async path => {
    if (path.endsWith('/device/code')) return { device_code: 'PRIVATE', user_code: 'ABCD-EFGH', expires_in: 300 };
    if (path.endsWith('/token')) return { access_token: 'PRIVATE', refresh_token: 'PRIVATE' };
    throw new Error('offline');
  } });
  const c = await flow.start('');
  await assert.rejects(flow.poll(c.id, ''), /核对授权账号/);
  assert.equal(flow.challenge, null);
});
