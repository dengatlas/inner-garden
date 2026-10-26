'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TabOutSyncClient } = require('../shared/sync-client');
const contract = require('../shared/workspace-sync');

async function fixture() {
  let now = Date.parse('2026-10-25T12:00:00Z');
  const values = new Map();
  const storage = { get: async key => values.get(key),
    set: async (key, value) => values.set(key, structuredClone(value)), remove: async key => values.delete(key) };
  const options = { storage, now: () => now, fetch: async () => { throw new Error('Unexpected refresh request'); },
    config: { enabled: true, environmentId: 'env', authBaseUrl: 'https://auth', apiBaseUrl: 'https://workspace' } };
  const client = new TabOutSyncClient(options);
  await client.initialize(contract.createEmptyWorkspace('2026-10-25'));
  return { client, options, values, now: () => now, advance: ms => { now += ms; } };
}

test('access-only login expires at the issued deadline and does not attempt a refresh', async () => {
  const h = await fixture();
  await h.client.setAuthenticatedSession('phone', { sub: 'phone-uid', access_token: 'private-access', expires_in: 7200 });
  assert.equal(Date.parse(h.client.auth.trustedUntil), h.now() + 7200000);
  assert.equal(await h.client.ensureAccessToken(), 'private-access');
  assert.equal(h.client.getSavedAccounts()[0].usable, true);
  h.advance(7200001);
  assert.equal(h.client.getSavedAccounts()[0].usable, false);
  await assert.rejects(h.client.ensureAccessToken(), /过期|失效/);
  assert.equal(h.client.auth, null);
});

test('absolute exchange expiry cannot be extended by waiting for UID confirmation', async () => {
  const h = await fixture();
  const expiresAt = h.now() + 30000;
  await h.client.setAuthenticatedSession('phone', { sub: 'phone-uid', access_token: 'private-access',
    expires_in: 7200, expires_at: expiresAt });
  assert.equal(h.client.auth.expiresAt, expiresAt);
  assert.equal(Date.parse(h.client.auth.trustedUntil), expiresAt);
  h.advance(30001);
  const loaded = new TabOutSyncClient(h.options);
  await loaded.load();
  assert.equal(loaded.auth, null);
  assert.equal(loaded.getSavedAccounts()[0].usable, false);
});

test('refreshable password sessions keep their existing ten-day trust boundary', async () => {
  const h = await fixture();
  await h.client.setAuthenticatedSession('password', { sub: 'password-uid', access_token: 'private-access',
    refresh_token: 'private-refresh', expires_in: 7200 });
  assert.equal(Date.parse(h.client.auth.trustedUntil), h.now() + 10 * 86400000);
  h.advance(7200001);
  assert.equal(h.client.getSavedAccounts()[0].usable, true);
});
