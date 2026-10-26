/* Short-lived OAuth device authorization. Credentials never leave the worker. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InnerGardenDeviceAuth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
  const SAFE_AUTH_CODES = new Set(['NOT_FOUND', 'METHOD_NOT_ALLOWED', 'INVALID_REQUEST', 'ORIGIN_NOT_ALLOWED',
    'INVALID_AUTHORIZATION', 'UNAUTHENTICATED', 'INVALID_TOKEN', 'AUTHORIZATION_PENDING', 'SLOW_DOWN',
    'ACCESS_DENIED', 'EXPIRED_TOKEN', 'INVALID_GRANT', 'INTERNAL_ERROR', 'UNAVAILABLE', 'DEADLINE_EXCEEDED',
    'RESOURCE_EXHAUSTED', 'PERMISSION_DENIED', 'FAILED_PRECONDITION']);
  function deviceError(message, code, cause) {
    const rawCode = String(cause?.authErrorCode || cause?.authErrorData?.error || '').toUpperCase();
    const status = Number(cause?.status || cause?.httpStatus || String(cause?.message || '').match(/\(([1-5]\d\d)\)\s*$/)?.[1]);
    const detail = [Number.isInteger(status) && status >= 100 && status <= 599 ? `HTTP ${status}` : '',
      SAFE_AUTH_CODES.has(rawCode) ? rawCode : ''].filter(Boolean).join(' · ');
    const error = new Error(`${message}${detail ? `（${detail}）` : ''}`);
    error.authErrorCode = code;
    return error;
  }
  function validUserCode(value) {
    return typeof value === 'string' && value.length >= 1 && value.length <= 256 && !/[\u0000-\u0020\u007f]/.test(value);
  }
  function challengeScope(data) {
    let scope = data.scope;
    if (scope === undefined) {
      for (const uri of [data.verification_uri_complete, data.verification_uri]) {
        if (typeof uri !== 'string' || !uri) continue;
        let parsed;
        try { parsed = new URL(uri); } catch (_error) { continue; }
        if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.searchParams.has('scope')) {
          scope = parsed.searchParams.get('scope');
          break;
        }
      }
    }
    if (scope === undefined) return '';
    if (typeof scope !== 'string' || !scope || scope.length > 256 || /[\u0000-\u001f\u007f]/.test(scope)) {
      throw deviceError('授权服务返回的授权范围无效，请重新生成二维码。', 'DEVICE_CHALLENGE_INVALID');
    }
    return scope;
  }
  function validExpiry(value) {
    return (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)))
      && Number.isFinite(Number(value)) && Number(value) > 0;
  }
  class DeviceAuthorization {
    constructor({ request, clientId, now = Date.now, createId = () => crypto.randomUUID() }) {
      this.request = request; this.clientId = clientId; this.now = now; this.createId = createId;
      this.challenge = null; this.generation = 0;
    }
    cancel() { this.generation += 1; this.challenge = null; return { status: 'cancelled' }; }
    current(id, ownerId) {
      const c = this.challenge;
      if (!c || c.id !== id || c.ownerId !== ownerId) return null;
      if (this.now() >= c.expiresAt || (c.sessionExpiresAt && this.now() >= c.sessionExpiresAt)) { this.cancel(); return null; }
      return c;
    }
    publicState(c) {
      return { id: c.id, status: c.session ? 'authorized' : 'waiting', userCode: c.userCode,
        expiresAt: c.expiresAt, intervalMs: c.intervalMs, userId: c.userId || '', label: c.label || '',
        ...(c.scope ? { scope: c.scope } : {}),
        ...(c.session ? { accessOnly: !c.session.refresh_token, sessionExpiresAt: c.sessionExpiresAt,
          sessionExpiresIn: Math.max(0, Math.floor((c.sessionExpiresAt - this.now()) / 1000)) } : {}) };
    }
    async start(ownerId) {
      this.cancel(); const generation = this.generation;
      let data;
      try {
        data = await this.request('/auth/v1/device/code', { body: { client_id: this.clientId } });
      } catch (error) {
        if (generation !== this.generation) return { status: 'cancelled' };
        throw deviceError('申请手机授权码失败，请重试。', 'DEVICE_CODE_REQUEST_FAILED', error);
      }
      if (generation !== this.generation) return { status: 'cancelled' };
      const seconds = Number(data?.expires_in);
      const userCode = data?.user_code;
      if (typeof data?.device_code !== 'string' || !data.device_code || !validUserCode(userCode) || !Number.isFinite(seconds) || seconds <= 0) {
        throw deviceError('授权服务没有返回有效编号，请重新生成二维码。', 'DEVICE_CHALLENGE_INVALID');
      }
      const interval = Number(data.interval);
      this.challenge = { id: this.createId(), ownerId, deviceCode: data.device_code, userCode, scope: challengeScope(data),
        expiresAt: this.now() + Math.min(seconds, 600) * 1000,
        intervalMs: Number.isFinite(interval) && interval > 0 ? Math.max(5000, interval * 1000) : 5000,
        nextPollAt: this.now(), session: null };
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
        throw deviceError('查询手机授权结果失败，将继续等待；若二维码过期请重新生成。', 'DEVICE_POLL_FAILED', error);
      }
      if (this.current(id, ownerId) !== c) return { status: 'expired' };
      const receivedAt = this.now();
      const expiresAt = receivedAt + Number(data?.expires_in) * 1000;
      const hasRefreshToken = data?.refresh_token !== undefined && data?.refresh_token !== null && data?.refresh_token !== '';
      if (typeof data?.access_token !== 'string' || !data.access_token || /[\u0000-\u0020\u007f]/.test(data.access_token)
        || !validExpiry(data?.expires_in) || !Number.isFinite(expiresAt) || expiresAt > 8640000000000000
        || (hasRefreshToken && (typeof data.refresh_token !== 'string' || /[\u0000-\u0020\u007f]/.test(data.refresh_token)))) {
        this.cancel(); throw deviceError('授权服务没有返回完整会话，请重新生成二维码并授权。', 'DEVICE_SESSION_INVALID');
      }
      // The account profile is fetched with the newly issued desktop token,
      // never with the previously active account's credentials.
      let profile;
      try {
        profile = await this.request('/auth/v1/user/me', { method: 'GET', accessToken: data.access_token });
      } catch (error) {
        if (this.current(id, ownerId) !== c) return { status: 'expired' };
        this.cancel();
        throw deviceError('无法核对授权账号，请重新生成二维码并授权。', 'DEVICE_PROFILE_LOOKUP_FAILED', error);
      }
      if (this.current(id, ownerId) !== c) return { status: 'expired' };
      const profileUid = profile?.sub || profile?.uid || profile?.user_id;
      const uid = typeof profileUid === 'string' ? profileUid : '';
      if (!uid || /[\u0000-\u0020\u007f]/.test(uid) || (data.sub !== undefined && (typeof data.sub !== 'string' || data.sub !== uid))) {
        this.cancel(); throw deviceError('授权会话与账号资料不一致，已停止登录；请重新生成二维码。', 'DEVICE_ACCOUNT_MISMATCH');
      }
      if (this.now() >= expiresAt) {
        this.cancel(); throw deviceError('本次授权会话已过期，请重新生成二维码并授权。', 'DEVICE_SESSION_INVALID');
      }
      c.session = { ...data, refresh_token: hasRefreshToken ? data.refresh_token : undefined,
        sub: uid, expires_in: Number(data.expires_in), expires_at: expiresAt };
      c.sessionExpiresAt = expiresAt; c.userId = uid;
      c.label = String(profile.name || profile.username || '手机授权账号');
      return this.publicState(c);
    }
    consume(id, ownerId, expectedUid) {
      const c = this.current(id, ownerId);
      if (!c?.session || c.userId !== String(expectedUid || '')) throw new Error('请重新核对并授权当前账号。');
      const secondsLeft = Math.floor((c.sessionExpiresAt - this.now()) / 1000);
      if (secondsLeft <= 0) { this.cancel(); throw new Error('本次授权会话已过期，请重新生成二维码并授权。'); }
      const result = { label: c.label, session: { ...c.session, expires_in: secondsLeft } };
      this.cancel(); return result;
    }
  }
  return { DeviceAuthorization, GRANT_TYPE };
});
