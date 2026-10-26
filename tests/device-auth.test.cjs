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
      if (path.endsWith('/token')) return { access_token: 'PRIVATE-ACCESS', refresh_token: 'PRIVATE-REFRESH', expires_in: 3600, sub: 'retained-uid' };
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
    : path.endsWith('/token') ? { access_token: 'PRIVATE', refresh_token: 'PRIVATE', expires_in: 3600, sub: 'one' }
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
    if (path.endsWith('/token')) return { access_token: 'PRIVATE', refresh_token: 'PRIVATE', expires_in: 3600 };
    throw new Error('offline');
  } });
  const c = await flow.start('');
  await assert.rejects(flow.poll(c.id, ''), /核对授权账号/);
  assert.equal(flow.challenge, null);
});

test('opaque user codes preserve case and punctuation without trimming or coercion', async t => {
  for (const userCode of ['a', 'Mixed_Case-09+/=', 'x'.repeat(256)]) {
    await t.test(`accepts opaque code of length ${userCode.length}`, async () => {
      const { flow } = fixture({ request: async () => ({ device_code: 'PRIVATE', user_code: userCode, expires_in: 300 }) });
      const result = await flow.start('');
      assert.equal(result.userCode, userCode);
      assert.equal(result.intervalMs, 5000);
    });
  }
  for (const userCode of ['', 'x'.repeat(257), ' code', 'code ', 'a\tb', 'a\nb', 'a\u0000b', 'a\u007fb', 1234, {}, ['code'], null, undefined]) {
    await t.test(`rejects invalid code ${typeof userCode} ${JSON.stringify(userCode)?.slice(0, 20)}`, async () => {
      const { flow } = fixture({ request: async () => ({ device_code: 'PRIVATE', user_code: userCode, expires_in: 300 }) });
      await assert.rejects(flow.start(''), error => error.authErrorCode === 'DEVICE_CHALLENGE_INVALID');
      assert.equal(flow.challenge, null);
    });
  }
});

test('malformed challenges and sessions fail with a controlled phase error', async () => {
  for (const data of [null, {}, { device_code: 12, user_code: 'opaque', expires_in: 300 },
    { device_code: 'PRIVATE', user_code: 'opaque', expires_in: 0 }]) {
    const { flow } = fixture({ request: async () => data });
    await assert.rejects(flow.start(''), error => error.authErrorCode === 'DEVICE_CHALLENGE_INVALID');
  }
  const { flow } = fixture({ request: async path => path.endsWith('/device/code')
    ? { device_code: 'PRIVATE', user_code: 'opaque', expires_in: 300 } : null });
  const started = await flow.start('');
  await assert.rejects(flow.poll(started.id, ''), error => error.authErrorCode === 'DEVICE_SESSION_INVALID');
  assert.equal(flow.challenge, null);
});

test('request diagnostics expose only safe status and auth codes, never raw upstream messages', async () => {
  const secret = 'PRIVATE-ACCESS user_code=Mixed_Case-09+/= device_code=PRIVATE-DEVICE';
  const upstream = Object.assign(new Error(`${secret} (503)`), { authErrorCode: 'INTERNAL_ERROR' });
  const { flow } = fixture({ request: async () => { throw upstream; } });
  await assert.rejects(flow.start(''), error => {
    assert.match(error.message, /申请手机授权码失败/);
    assert.match(error.message, /HTTP 503.*INTERNAL_ERROR/);
    assert.doesNotMatch(error.message, /PRIVATE|user_code|device_code|Mixed/);
    return true;
  });
});

test('profile failure discards the grant and an explicitly new challenge can recover', async () => {
  let profileFails = true;
  const { flow, calls } = fixture({ request: async path => {
    if (path.endsWith('/device/code')) return { device_code: 'PRIVATE', user_code: 'Mixed_Code+/=', expires_in: 300 };
    if (path.endsWith('/token')) return { access_token: 'PRIVATE', refresh_token: 'PRIVATE', expires_in: 3600, sub: 'phone-uid' };
    if (profileFails) throw Object.assign(new Error('sensitive detail (503)'), { authErrorCode: 'UNAVAILABLE' });
    return { sub: 'phone-uid' };
  } });
  const first = await flow.start('');
  await assert.rejects(flow.poll(first.id, ''), error => {
    assert.equal(error.authErrorCode, 'DEVICE_PROFILE_LOOKUP_FAILED');
    assert.match(error.message, /重新生成二维码.*HTTP 503.*UNAVAILABLE/);
    assert.doesNotMatch(error.message, /sensitive/);
    return true;
  });
  assert.deepEqual(await flow.poll(first.id, ''), { status: 'expired' });
  assert.equal(calls.filter(call => call.path.endsWith('/token')).length, 1);
  profileFails = false;
  const second = await flow.start('');
  assert.notEqual(second.id, first.id);
  assert.equal((await flow.poll(second.id, '')).status, 'authorized');
});

test('server-issued scope is read from the response or HTTPS verification URI and remains public', async () => {
  for (const fields of [
    { scope: 'user sso' },
    { verification_uri: 'https://account.example/verify?scope=user%20sso' },
    { verification_uri_complete: 'https://account.example/verify?scope=user+sso&user_code=opaque' },
    { scope: 'user', verification_uri: 'https://account.example/verify?scope=user%20sso' },
  ]) {
    const { flow } = fixture({ request: async () => ({ device_code: 'PRIVATE', user_code: 'Opaque_Case', expires_in: 300, ...fields }) });
    const state = await flow.start('');
    assert.equal(state.scope, fields.scope || 'user sso');
    assert.doesNotMatch(JSON.stringify(state), /PRIVATE|verification_uri|device_code/);
  }
  for (const scope of ['', 'x'.repeat(257), 'user\nsso', 'user\u007fsso', ['user'], 123]) {
    const { flow } = fixture({ request: async () => ({ device_code: 'PRIVATE', user_code: 'opaque', expires_in: 300, scope }) });
    await assert.rejects(flow.start(''), error => error.authErrorCode === 'DEVICE_CHALLENGE_INVALID');
    assert.equal(flow.challenge, null);
  }
  const { flow } = fixture({ request: async () => ({ device_code: 'PRIVATE', user_code: 'opaque', expires_in: 300,
    verification_uri: 'http://account.example/verify?scope=user+sso' }) });
  assert.equal((await flow.start('')).scope, undefined);
});

test('access-only device sessions require exact UID confirmation and retain the actual expiry', async () => {
  const { flow, advance, calls } = fixture({ request: async path => {
    if (path.endsWith('/device/code')) return { device_code: 'PRIVATE', user_code: 'Opaque_Case', expires_in: 300, scope: 'user sso' };
    if (path.endsWith('/token')) return { access_token: 'PRIVATE-ACCESS', token_type: 'Bearer', expires_in: 5400, sub: 'phone-uid' };
    return { sub: 'phone-uid', name: 'Phone account' };
  } });
  const started = await flow.start('');
  const preview = await flow.poll(started.id, '');
  assert.equal(preview.status, 'authorized');
  assert.equal(preview.accessOnly, true);
  assert.equal(preview.scope, 'user sso');
  assert.equal(preview.sessionExpiresIn, 5400);
  assert.equal(preview.sessionExpiresAt, 5401000);
  assert.doesNotMatch(JSON.stringify(preview), /PRIVATE|access_token|refresh_token/);
  assert.equal(calls.at(-1).options.accessToken, 'PRIVATE-ACCESS');
  assert.throws(() => flow.consume(started.id, '', 'wrong-uid'), /核对/);
  advance(31000);
  const session = flow.consume(started.id, '', 'phone-uid').session;
  assert.equal(session.expires_in, 5369);
  assert.equal(session.expires_at, 5401000);
  assert.equal(session.refresh_token, undefined);
  assert.equal(session.access_token, 'PRIVATE-ACCESS');
});

test('device sessions reject missing or invalid expiry, malformed tokens, and invalid optional refresh tokens', async () => {
  for (const data of [
    { access_token: 'PRIVATE' }, { access_token: 'PRIVATE', expires_in: 0 },
    { access_token: 'PRIVATE', expires_in: -5 }, { access_token: 'PRIVATE', expires_in: Infinity },
    { access_token: 'PRIVATE', expires_in: true }, { access_token: 'PRIVATE', expires_in: 'not-seconds' },
    { access_token: 'PRIVATE', expires_in: 1e100 }, { expires_in: 3600 },
    { access_token: 123, expires_in: 3600 }, { access_token: '', expires_in: 3600 },
    { access_token: 'PRIVATE\nTOKEN', expires_in: 3600 },
    { access_token: 'PRIVATE', refresh_token: 123, expires_in: 3600 },
  ]) {
    const { flow, calls } = fixture({ request: async path => path.endsWith('/device/code')
      ? { device_code: 'PRIVATE', user_code: 'opaque', expires_in: 300 } : data });
    const started = await flow.start('');
    await assert.rejects(flow.poll(started.id, ''), error => error.authErrorCode === 'DEVICE_SESSION_INVALID');
    assert.equal(flow.challenge, null);
    assert.equal(calls.length, 2);
  }
});

test('access-only profile mismatch is rejected and expired access cannot be confirmed', async () => {
  for (const profile of [{}, { sub: 'another-uid' }, { sub: {} }, { sub: 123 }, { sub: ' ' }]) {
    const { flow } = fixture({ request: async path => path.endsWith('/device/code')
      ? { device_code: 'PRIVATE', user_code: 'opaque', expires_in: 300 }
      : path.endsWith('/token') ? { access_token: 'PRIVATE', expires_in: 3600, sub: 'expected-uid' } : profile });
    const started = await flow.start('');
    await assert.rejects(flow.poll(started.id, ''), error => error.authErrorCode === 'DEVICE_ACCOUNT_MISMATCH');
  }
  const { flow, advance } = fixture({ request: async path => path.endsWith('/device/code')
    ? { device_code: 'PRIVATE', user_code: 'opaque', expires_in: 300 }
    : path.endsWith('/token') ? { access_token: 'PRIVATE', expires_in: 10, sub: 'phone-uid' } : { sub: 'phone-uid' } });
  const started = await flow.start('');
  await flow.poll(started.id, '');
  advance(10000);
  assert.throws(() => flow.consume(started.id, '', 'phone-uid'), /核对/);
  assert.equal(flow.challenge, null);
});

test('empty optional refresh credentials remain access-only without creating a fake refresh session', async () => {
  for (const refreshToken of [undefined, null, '']) {
    const { flow } = fixture({ request: async path => path.endsWith('/device/code')
      ? { device_code: 'PRIVATE', user_code: 'opaque', expires_in: 300 }
      : path.endsWith('/token') ? { access_token: 'PRIVATE', refresh_token: refreshToken, expires_in: 3600, sub: 'phone-uid' }
        : { sub: 'phone-uid' } });
    const started = await flow.start('');
    assert.equal((await flow.poll(started.id, '')).accessOnly, true);
    assert.equal(flow.consume(started.id, '', 'phone-uid').session.refresh_token, undefined);
  }
});
