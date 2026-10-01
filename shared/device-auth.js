/* Short-lived OAuth device authorization. Credentials never leave the worker. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InnerGardenDeviceAuth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
  class DeviceAuthorization {
    constructor({ request, clientId, now = Date.now, createId = () => crypto.randomUUID() }) {
      this.request = request; this.clientId = clientId; this.now = now; this.createId = createId;
      this.challenge = null; this.generation = 0;
    }
    cancel() { this.generation += 1; this.challenge = null; return { status: 'cancelled' }; }
    current(id, ownerId) {
      const c = this.challenge;
      if (!c || c.id !== id || c.ownerId !== ownerId) return null;
      if (this.now() >= c.expiresAt) { this.cancel(); return null; }
      return c;
    }
    publicState(c) {
      return { id: c.id, status: c.session ? 'authorized' : 'waiting', userCode: c.userCode,
        expiresAt: c.expiresAt, intervalMs: c.intervalMs, userId: c.userId || '', label: c.label || '' };
    }
    async start(ownerId) {
      this.cancel(); const generation = this.generation;
      const data = await this.request('/auth/v1/device/code', { body: { client_id: this.clientId } });
      if (generation !== this.generation) return { status: 'cancelled' };
      const seconds = Number(data.expires_in);
      const userCode = String(data.user_code || '').trim();
      if (!data.device_code || !/^[A-Za-z0-9-]{4,32}$/.test(userCode) || !Number.isFinite(seconds) || seconds <= 0) {
        throw new Error('授权服务没有返回有效编号，请重新获取。');
      }
      this.challenge = { id: this.createId(), ownerId, deviceCode: data.device_code, userCode,
        expiresAt: this.now() + Math.min(seconds, 600) * 1000,
        intervalMs: Math.max(5000, Number(data.interval || 5) * 1000), nextPollAt: this.now(), session: null };
      return this.publicState(this.challenge);
    }
    async poll(id, ownerId) {
      const c = this.current(id, ownerId);
      if (!c) return { status: 'expired' };
      if (c.session || this.now() < c.nextPollAt) return this.publicState(c);
      c.nextPollAt = this.now() + c.intervalMs;
      let data;
      try {
        data = await this.request('/auth/v1/token', { body: {
          client_id: this.clientId, grant_type: GRANT_TYPE, device_code: c.deviceCode,
        } });
      } catch (error) {
        if (this.current(id, ownerId) !== c) return { status: 'expired' };
        const code = String(error.authErrorData?.error || error.authErrorCode || '').toLowerCase();
        if (code === 'authorization_pending') return this.publicState(c);
        if (code === 'slow_down') { c.intervalMs += 5000; c.nextPollAt = this.now() + c.intervalMs; return this.publicState(c); }
        if (['access_denied', 'expired_token', 'invalid_grant'].includes(code)) {
          this.cancel(); return { status: code === 'access_denied' ? 'denied' : 'expired' };
        }
        throw error;
      }
      if (this.current(id, ownerId) !== c) return { status: 'expired' };
      if (!data.access_token || !data.refresh_token) {
        this.cancel(); throw new Error('授权服务没有返回完整会话，请重新授权。');
      }
      // The account profile is fetched with the newly issued desktop token,
      // never with the previously active account's credentials.
      let profile;
      try {
        profile = await this.request('/auth/v1/user/me', { method: 'GET', accessToken: data.access_token });
      } catch (_error) {
        if (this.current(id, ownerId) !== c) return { status: 'expired' };
        this.cancel();
        throw new Error('无法核对授权账号，请重新生成编号并授权。');
      }
      if (this.current(id, ownerId) !== c) return { status: 'expired' };
      const uid = String(profile.sub || profile.uid || profile.user_id || '');
      if (!uid || (data.sub && String(data.sub) !== uid)) {
        this.cancel(); throw new Error('授权会话与账号资料不一致，已停止登录。');
      }
      c.session = { ...data, sub: uid }; c.userId = uid;
      c.label = String(profile.name || profile.username || '手机授权账号');
      return this.publicState(c);
    }
    consume(id, ownerId, expectedUid) {
      const c = this.current(id, ownerId);
      if (!c?.session || c.userId !== String(expectedUid || '')) throw new Error('请重新核对并授权当前账号。');
      const result = { label: c.label, session: c.session };
      this.cancel(); return result;
    }
  }
  return { DeviceAuthorization, GRANT_TYPE };
});
