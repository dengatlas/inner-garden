(function initSyncClient(root, factory) {
  const api = factory(root.TabOutWorkspaceSync);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TabOutSyncClient = api.TabOutSyncClient;
})(typeof globalThis !== 'undefined' ? globalThis : this, function syncClientFactory(contract) {
  'use strict';

  if (!contract && typeof require === 'function') contract = require('./workspace-sync');

  const DEFAULT_STATE = Object.freeze({
    deviceId: '',
    cursor: 0,
    versions: {},
    baseline: {},
    queue: [],
    conflicts: [],
    recoveryHistory: [],
    clockOffsetMs: 0,
    lastSyncedAt: '',
    lastSyncSummary: null,
    lastUsername: '',
    seeded: false,
    firstBackup: null,
    firstBackupLocked: false,
  });
  const DEFAULT_TRUSTED_SESSION_MS = 10 * 24 * 60 * 60 * 1000;

  class TabOutSyncClient {
    constructor(options = {}) {
      this.storage = options.storage;
      this.fetch = options.fetch || globalThis.fetch?.bind(globalThis);
      this.config = options.config || {};
      this.stateKey = options.stateKey || 'tabOutSyncState';
      this.authKey = options.authKey || 'tabOutSyncAuth';
      this.accountsKey = options.accountsKey || `${this.authKey}Accounts`;
      this.accountStatesKey = options.accountStatesKey || `${this.stateKey}Accounts`;
      // A deliberate environment migration starts fresh sessions/cursors without
      // deleting the previous environment's local recovery data.
      if (this.config.storageNamespace) {
        const suffix = `:${this.config.storageNamespace}`;
        this.stateKey += suffix;
        this.authKey += suffix;
        this.accountsKey += suffix;
        this.accountStatesKey += suffix;
      }
      this.trustedSessionMs = Math.max(60000, Number(options.trustedSessionMs) || DEFAULT_TRUSTED_SESSION_MS);
      this.onStatus = options.onStatus || (() => {});
      this.now = options.now || (() => Date.now());
      this.state = null;
      this.auth = null;
      this.accounts = null;
      this.accountStates = null;
      this.syncPromise = null;
      this.savePromise = Promise.resolve();
      this.latestWorkspace = null;
      this.syncProgress = null;
    }

    get enabled() {
      return Boolean(this.config.enabled && this.config.apiBaseUrl && this.config.authBaseUrl && this.fetch);
    }

    async load() {
      const [storedState, storedAuth, storedAccounts, storedAccountStates] = await Promise.all([
        this.storage.get(this.stateKey),
        this.storage.get(this.authKey),
        this.storage.get(this.accountsKey),
        this.storage.get(this.accountStatesKey),
      ]);
      this.accounts = normalizeAccounts(storedAccounts);
      this.accountStates = normalizeAccountStates(storedAccountStates);
      if (storedAuth) {
        storedAuth.signedInAt ||= getTokenIssuedAt(storedAuth.accessToken) || new Date(this.now()).toISOString();
        storedAuth.trustedUntil ||= new Date(this.now() + this.trustedSessionMs).toISOString();
        storedAuth.lastUsedAt ||= storedAuth.signedInAt;
        const migratedAccountId = getAccountId(storedAuth);
        if (migratedAccountId) {
          this.accounts.sessions[migratedAccountId] = { ...storedAuth, accountId: migratedAccountId };
          this.accounts.activeAccountId ||= migratedAccountId;
          if (!this.accountStates.states[migratedAccountId] && storedState) {
            this.accountStates.states[migratedAccountId] = contract.clone(storedState);
          }
        }
      }
      for (const session of Object.values(this.accounts.sessions)) {
        if (Date.parse(session.trustedUntil || '') <= this.now()) expireSession(session);
      }
      const activeSession = this.accounts.sessions[this.accounts.activeAccountId] || null;
      this.auth = isTrustedSession(activeSession, this.now()) ? activeSession : null;
      if (activeSession && !this.auth) {
        expireSession(activeSession);
        this.accounts.activeAccountId = '';
      }
      const activeStoredState = this.auth ? this.accountStates.states[this.auth.accountId] : null;
      this.state = { ...contract.clone(DEFAULT_STATE), ...(activeStoredState || storedState || {}) };
      this.state.deviceId ||= contract.createId('device');
      this.state.versions ||= {};
      this.state.baseline ||= {};
      this.state.queue ||= [];
      this.state.conflicts ||= [];
      this.state.recoveryHistory ||= [];
      this.state.clockOffsetMs = Number(this.state.clockOffsetMs || 0);
      this.state.lastUsername ||= '';
      for (const operation of this.state.queue) {
        operation.clientModifiedAt ||= operation.queuedAt || this.nowIso();
        operation.initialSeed = Boolean(operation.initialSeed);
      }
      if (this.auth) {
        this.state.firstBackupLocked = true;
      }
      await this.save();
      return this.getPublicState();
    }

    async initialize(workspace) {
      if (!this.state) await this.load();
      if (!this.state.firstBackupLocked) this.state.firstBackup = contract.clone(workspace);
      if (!this.state.seeded) {
        this.state.baseline = {};
        this.state.seeded = true;
        await this.captureWorkspace(workspace, { initialSeed: true });
      } else {
        await this.captureWorkspace(workspace);
      }
      return this.getPublicState();
    }

    getPublicState() {
      return {
        enabled: this.enabled,
        configured: Boolean(this.config.apiBaseUrl && this.config.authBaseUrl),
        loggedIn: Boolean(this.auth?.refreshToken || this.auth?.accessToken),
        accountId: this.auth?.accountId || '',
        username: this.auth?.username || '',
        userId: this.auth?.userId || '',
        signedInAt: this.auth?.signedInAt || '',
        trustedUntil: this.auth?.trustedUntil || '',
        savedAccounts: this.getSavedAccounts(),
        lastUsername: this.state?.lastUsername || '',
        deviceId: this.state?.deviceId || '',
        cursor: this.state?.cursor || 0,
        queued: this.state?.queue?.length || 0,
        conflicts: this.state?.conflicts?.length || 0,
        lastSyncedAt: this.state?.lastSyncedAt || '',
        lastSyncSummary: contract.clone(this.state?.lastSyncSummary || null),
      };
    }

    emitStatus(status, detail = '') {
      this.onStatus({ status, detail, ...this.getPublicState() });
    }

    async save() {
      if (this.auth?.accountId && this.state) {
        this.accountStates.states[this.auth.accountId] = contract.clone(this.state);
        this.accounts.sessions[this.auth.accountId] = { ...this.auth };
        this.accounts.activeAccountId = this.auth.accountId;
        this.accounts.lastAccountId = this.auth.accountId;
      }
      const snapshot = contract.clone({ state: this.state, accounts: this.accounts, accountStates: this.accountStates, auth: this.auth });
      this.savePromise = this.savePromise.catch(() => {}).then(async () => {
        if (snapshot.state) await this.storage.set(this.stateKey, snapshot.state);
        if (snapshot.accounts) await this.storage.set(this.accountsKey, snapshot.accounts);
        if (snapshot.accountStates) await this.storage.set(this.accountStatesKey, snapshot.accountStates);
        if (snapshot.auth) await this.storage.set(this.authKey, snapshot.auth);
        else await this.storage.remove(this.authKey);
      });
      return this.savePromise;
    }

    getSavedAccounts() {
      if (!this.accounts) return [];
      return Object.values(this.accounts.sessions)
        .map(session => ({
          accountId: session.accountId || getAccountId(session),
          username: session.username || '',
          userId: session.userId || '',
          signedInAt: session.signedInAt || '',
          trustedUntil: session.trustedUntil || '',
          lastUsedAt: session.lastUsedAt || session.signedInAt || '',
          usable: isTrustedSession(session, this.now()),
          active: session.accountId === this.auth?.accountId,
        }))
        .sort((left, right) => Date.parse(right.lastUsedAt || '') - Date.parse(left.lastUsedAt || ''));
    }

    async captureWorkspace(workspace, options = {}) {
      if (!this.state) await this.load();
      this.latestWorkspace = contract.clone(workspace);
      if (!this.state.firstBackupLocked) this.state.firstBackup = contract.clone(workspace);
      const current = contract.workspaceToEntityMap(workspace);
      const previous = this.state.baseline || {};
      const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);

      for (const key of keys) {
        const before = previous[key];
        const after = current[key];
        let existingIndex = -1;
        this.state.queue.forEach((operation, index) => { if (operation.entityKey === key) existingIndex = index; });
        const existing = existingIndex >= 0 ? this.state.queue[existingIndex] : null;

        if (contract.entitiesEqual(before, after)) continue;
        if (!before && !after) continue;

        if (!after && !before && existingIndex >= 0) {
          this.state.queue.splice(existingIndex, 1);
          continue;
        }

        const entity = after || before;
        const operation = {
          opId: existing && !existing.sent ? existing.opId : contract.createId('op'),
          deviceId: this.state.deviceId,
          entityKey: key,
          entityType: entity.type,
          entityId: entity.id,
          baseVersion: existing?.baseVersion ?? Number(this.syncProgress?.versions[key] ?? this.state.versions[key] ?? 0),
          action: after ? 'upsert' : 'delete',
          payload: after ? contract.clone(after.payload) : null,
          clientModifiedAt: this.nowIso(),
          queuedAt: existing?.queuedAt || this.nowIso(),
          initialSeed: Boolean(options.initialSeed),
          ...(existing?.sent ? { dependsOnOpId: existing.opId } : existing?.dependsOnOpId ? { dependsOnOpId: existing.dependsOnOpId } : {}),
        };
        if (existingIndex >= 0 && !existing.sent) this.state.queue[existingIndex] = operation;
        else this.state.queue.push(operation);
      }

      this.state.baseline = contract.clone(current);
      await this.save();
      this.emitStatus(navigatorOnLine() ? 'pending' : 'offline');
      return this.state.queue.length;
    }

    async login(username, password) {
      if (!this.enabled) throw new Error('Sync is not configured');
      const normalizedUsername = String(username || '').trim();
      if (!normalizedUsername || !password) throw new Error('Enter your phone number, email, or username and password');
      this.emitStatus('signing-in');
      const data = await this.authRequest('/auth/v1/signin', {
        body: { username: normalizedUsername, password },
        fallback: 'Sign in failed',
      });
      if (!data.access_token) throw createSyncError('account', 'The sign-in service did not return a valid session');
      await this.setAuthenticatedSession(normalizedUsername, data);
      return this.getPublicState();
    }

    async loginWithVerification({ kind, value, verificationToken } = {}) {
      if (!this.enabled) throw new Error('Sync is not configured');
      const contact = normalizeContact(kind, value);
      const normalizedToken = String(verificationToken || '').trim();
      if (!normalizedToken) throw new Error('Verify the phone number before signing in');
      this.emitStatus('signing-in');
      const data = await this.authRequest('/auth/v1/signin', {
        body: { verification_token: normalizedToken },
        fallback: 'Verification code sign in failed',
      });
      if (!data.access_token) throw createSyncError('account', 'The sign-in service did not return a valid session');
      await this.setAuthenticatedSession(contact.phone_number || contact.email, data);
      return this.getPublicState();
    }

    async grantProviderToken({ providerId, providerCode, providerParams } = {}) {
      const normalizedProviderId = String(providerId || '').trim();
      const normalizedProviderCode = String(providerCode || '').trim();
      if (!normalizedProviderId || !normalizedProviderCode) throw new Error('Provider authorization is incomplete');
      const data = await this.authRequest('/auth/v1/provider/token', {
        body: {
          provider_id: normalizedProviderId,
          provider_code: normalizedProviderCode,
          ...(providerParams && typeof providerParams === 'object' ? { provider_params: providerParams } : {}),
        },
        fallback: 'Provider authorization failed',
      });
      if (!data.provider_token) throw createSyncError('account', 'The provider authorization service did not return a valid credential');
      return data.provider_token;
    }

    async loginWithProvider({ providerId, providerCode, providerParams, label = 'Connected account' } = {}) {
      if (!this.enabled) throw new Error('Sync is not configured');
      this.emitStatus('signing-in');
      const providerToken = await this.grantProviderToken({ providerId, providerCode, providerParams });
      const data = await this.authRequest('/auth/v1/signin/with/provider', {
        body: { provider_token: providerToken, force_disable_sign_up: false },
        fallback: 'Provider sign in failed',
      });
      if (!data.access_token) throw createSyncError('account', 'The sign-in service did not return a valid session');
      await this.setAuthenticatedSession(String(label || 'Connected account'), data);
      return this.getPublicState();
    }

    async sendEmailVerification(email) {
      const contact = normalizeContact('email', email);
      const verification = await this.sendVerification({ kind: 'email', value: contact.email });
      return { channel: 'email', email: contact.email, ...verification };
    }

    async sendPhoneVerification(phoneNumber) {
      const contact = normalizeContact('phone', phoneNumber);
      const verification = await this.sendVerification({ kind: 'phone', value: contact.phone_number });
      return { channel: 'phone', phoneNumber: contact.phone_number, ...verification };
    }

    async registerWithEmail({ email, verificationId, verificationCode, username, password } = {}) {
      const contact = normalizeContact('email', email);
      return this.registerWithVerifiedContact({
        kind: 'email',
        value: contact.email,
        verificationId,
        verificationCode,
        username,
        password,
      });
    }

    async registerWithPhone({ phoneNumber, verificationId, verificationCode, username, password } = {}) {
      const contact = normalizeContact('phone', phoneNumber);
      return this.registerWithVerifiedContact({
        kind: 'phone',
        value: contact.phone_number,
        verificationId,
        verificationCode,
        username,
        password,
      });
    }

    async registerWithVerifiedContact({ kind, value, verificationId, verificationCode, username, password } = {}) {
      const normalizedUsername = normalizeOptionalUsername(username);
      const normalizedPassword = String(password || '');
      const normalizedCode = String(verificationCode || '').trim();
      if (!/^\d{6}$/.test(normalizedCode)) throw new Error('Enter the 6-digit verification code');
      if (kind === 'email' && !normalizedPassword) throw new Error('Email registration requires a password');
      if (normalizedPassword && normalizedPassword.length < 8) throw new Error('Password must be at least 8 characters');
      const verified = await this.verifyVerification(verificationId, normalizedCode);
      return this.register({
        kind,
        value,
        username: normalizedUsername,
        password: normalizedPassword,
        verificationToken: verified.verificationToken,
      });
    }

    async sendVerification({ kind, value, target = 'ANY', usage = '', captchaToken = '', authorized = false } = {}) {
      const contact = normalizeContact(kind, value);
      const data = await this.authRequest('/auth/v1/verification', {
        body: { target, ...contact, ...(usage ? { usage } : {}) },
        captchaToken,
        authorized,
        fallback: 'Verification code delivery failed',
      });
      if (!data.verification_id) throw createSyncError('account', 'The verification service did not return a valid credential');
      return {
        verificationId: data.verification_id,
        expiresIn: Number(data.expires_in || 600),
        isUser: Boolean(data.is_user),
      };
    }

    async verifyVerification(verificationId, verificationCode) {
      const normalizedId = String(verificationId || '').trim();
      const normalizedCode = String(verificationCode || '').trim();
      if (!normalizedId || !/^\d{6}$/.test(normalizedCode)) throw new Error('Enter the 6-digit verification code');
      const data = await this.authRequest('/auth/v1/verification/verify', {
        body: { verification_id: normalizedId, verification_code: normalizedCode },
        fallback: 'Verification code validation failed',
      });
      if (!data.verification_token) throw createSyncError('account', 'The verification result is invalid; request a new code');
      return {
        verificationToken: data.verification_token,
        expiresIn: Number(data.expires_in || 600),
      };
    }

    async register({ kind, value, username, password, verificationToken } = {}) {
      const contact = normalizeContact(kind, value);
      const normalizedUsername = normalizeOptionalUsername(username);
      const normalizedPassword = String(password || '');
      if (!verificationToken) throw new Error('Complete the registration verification');
      if (kind === 'email' && !normalizedPassword) throw new Error('Email registration requires a password');
      if (normalizedPassword && normalizedPassword.length < 8) throw new Error('Password must be at least 8 characters');
      const data = await this.authRequest('/auth/v1/signup', {
        body: {
          ...contact,
          verification_token: String(verificationToken),
          ...(normalizedUsername ? { username: normalizedUsername } : {}),
          ...(normalizedPassword ? { password: normalizedPassword } : {}),
        },
        fallback: 'Registration failed',
      });
      if (!data.access_token) throw createSyncError('account', 'Registration succeeded, but no sign-in session was created');
      await this.setAuthenticatedSession(normalizedUsername || contact.phone_number || contact.email, data);
      return this.getPublicState();
    }

    async resetPassword({ kind, value, password, verificationToken } = {}) {
      if (!password || !verificationToken) throw new Error('Verify the account and set a new password');
      await this.authRequest('/auth/v1/reset', {
        body: {
          ...normalizeContact(kind, value),
          verification_token: String(verificationToken),
          new_password: password,
        },
        fallback: 'Password reset failed',
      });
    }

    async getCaptchaData() {
      const data = await this.authRequest('/auth/v1/captcha/data', {
        body: {},
        fallback: 'Captcha request failed',
      });
      if (!data.data || !data.token) throw createSyncError('account', 'The captcha response is invalid; refresh and try again');
      return { image: data.data, token: data.token, expiresIn: Number(data.expires_in || 300) };
    }

    async verifyCaptchaData(token, key) {
      const data = await this.authRequest('/auth/v1/captcha/data/verify', {
        body: { token: String(token || ''), key: String(key || '').trim() },
        fallback: 'Captcha validation failed',
      });
      if (!data.captcha_token) throw createSyncError('account', 'The captcha expired; refresh and try again');
      return { captchaToken: data.captcha_token, expiresIn: Number(data.expires_in || 300) };
    }

    async getAccountProfile() {
      const data = await this.authRequest('/auth/v1/user/me', {
        method: 'GET',
        authorized: true,
        fallback: 'Account profile request failed',
      });
      return contract.clone(normalizeAccountProfile(data));
    }

    async updateAccountProfile({ nickname, gender } = {}) {
      const normalizedNickname = String(nickname || '').trim();
      const normalizedGender = String(gender || '').trim().toUpperCase();
      if (normalizedNickname && (normalizedNickname.length < 2 || normalizedNickname.length > 48)) {
        throw new Error('Nickname must be 2–48 characters');
      }
      if (normalizedGender && !['MALE', 'FEMALE', 'UNKNOWN'].includes(normalizedGender)) {
        throw new Error('Select a valid gender');
      }
      const body = {
        ...(normalizedNickname ? { nickname: normalizedNickname } : {}),
        ...(normalizedGender ? { gender: normalizedGender } : {}),
      };
      if (!Object.keys(body).length) throw new Error('Enter a nickname or select a gender');
      await this.authRequest('/auth/v1/user/basic/edit', {
        body,
        authorized: true,
        fallback: 'Account profile update failed',
      });
      return this.getAccountProfile();
    }

    async getProviders() {
      const data = await this.authRequest('/auth/v1/user/provider', {
        method: 'GET',
        authorized: true,
        fallback: 'Provider list request failed',
      });
      return contract.clone(normalizeProviders(data));
    }

    async bindProvider({ providerId, providerCode, providerParams } = {}) {
      const providerToken = await this.grantProviderToken({ providerId, providerCode, providerParams });
      await this.authRequest('/auth/v1/user/provider/bind', {
        body: { provider_token: providerToken, with_user_center: true },
        authorized: true,
        fallback: 'Provider binding failed',
      });
      return this.getProviders();
    }

    async unbindProvider(providerId) {
      const normalizedProviderId = String(providerId || '').trim();
      if (!normalizedProviderId) throw new Error('Select a provider to unbind');
      await this.authRequest(`/auth/v1/user/provider/${encodeURIComponent(normalizedProviderId)}`, {
        method: 'DELETE',
        authorized: true,
        fallback: 'Provider unbinding failed',
      });
      return this.getProviders();
    }

    async bindContact({ kind, value, password, verificationToken } = {}) {
      if (!password || !verificationToken) throw new Error('Enter the current password and verify the new contact');
      const sudo = await this.authRequest('/auth/v1/user/sudo', {
        body: { password },
        authorized: true,
        fallback: 'Current password verification failed',
      });
      if (!sudo.sudo_token) throw createSyncError('credentials', 'Current password verification failed');
      await this.authRequest('/auth/v1/user/contact', {
        method: 'PATCH',
        body: {
          ...normalizeContact(kind, value),
          sudo_token: sudo.sudo_token,
          verification_token: String(verificationToken),
        },
        authorized: true,
        fallback: 'Contact binding failed',
      });
    }

    async changePassword({ oldPassword, newPassword } = {}) {
      const currentUsername = this.auth?.username || '';
      if (!currentUsername || !oldPassword || !newPassword) {
        throw new Error('Enter the current password and new password');
      }
      const sudo = await this.authRequest('/auth/v1/user/sudo', {
        body: { password: oldPassword },
        authorized: true,
        fallback: 'Current password verification failed',
      });
      if (!sudo.sudo_token) throw createSyncError('credentials', 'Current password verification failed');
      await this.authRequest('/auth/v1/user/password', {
        method: 'PATCH',
        body: {
          sudo_token: sudo.sudo_token,
          new_password: newPassword,
        },
        authorized: true,
        fallback: 'Password change failed',
      });
      await this.login(currentUsername, newPassword);
      return this.getPublicState();
    }

    async switchAccount(accountId) {
      if (this.syncPromise) await this.syncPromise.catch(() => {});
      if (!this.state) await this.load();
      const target = this.accounts.sessions[String(accountId || '')];
      if (!isTrustedSession(target, this.now())) {
        if (target) expireSession(target);
        await this.save();
        throw createSyncError('credentials', 'This saved session expired. Sign in again.');
      }
      if (this.auth?.accountId === target.accountId) return this.getPublicState();
      if (this.auth?.accountId) this.accountStates.states[this.auth.accountId] = contract.clone(this.state);
      const deviceId = this.state.deviceId;
      this.auth = { ...target, lastUsedAt: new Date(this.now()).toISOString() };
      this.state = {
        ...contract.clone(DEFAULT_STATE),
        ...(this.accountStates.states[target.accountId] || {}),
      };
      this.state.deviceId ||= deviceId || contract.createId('device');
      this.state.lastUsername = target.username || this.state.lastUsername || '';
      this.state.firstBackupLocked = true;
      await this.save();
      this.emitStatus('signed-in');
      return this.getPublicState();
    }

    async forgetAccount(accountId) {
      if (!this.state) await this.load();
      const normalizedId = String(accountId || '');
      if (!normalizedId || normalizedId === this.auth?.accountId) throw new Error('Sign out of the current account before removing it');
      delete this.accounts.sessions[normalizedId];
      delete this.accountStates.states[normalizedId];
      await this.save();
      return this.getPublicState();
    }

    async setAuthenticatedSession(username, data) {
      if (this.syncPromise) await this.syncPromise.catch(() => {});
      const previousAccountId = this.auth?.accountId || '';
      const previousStateAccountId = previousAccountId || this.accounts.lastAccountId || '';
      if (previousAccountId) this.accountStates.states[previousAccountId] = contract.clone(this.state);
      const session = {
        username,
        userId: data.sub || '',
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: this.now() + Number(data.expires_in || 7200) * 1000,
        signedInAt: getTokenIssuedAt(data.access_token) || new Date(this.now()).toISOString(),
        trustedUntil: new Date(this.now() + this.trustedSessionMs).toISOString(),
        lastUsedAt: new Date(this.now()).toISOString(),
      };
      session.accountId = getAccountId(session);
      this.auth = session;
      this.accounts.sessions[session.accountId] = { ...session };
      this.accounts.activeAccountId = session.accountId;
      this.accounts.lastAccountId = session.accountId;
      if (previousStateAccountId && previousStateAccountId !== session.accountId) {
        const deviceId = this.state.deviceId;
        this.state = {
          ...contract.clone(DEFAULT_STATE),
          ...(this.accountStates.states[session.accountId] || {}),
        };
        this.state.deviceId ||= deviceId || contract.createId('device');
      }
      this.state.lastUsername = username;
      this.state.firstBackupLocked = true;
      await this.save();
      this.emitStatus('signed-in');
    }

    async authRequest(path, options = {}) {
      if (!this.enabled) throw new Error('Sync is not configured');
      if (!this.state) await this.load();
      const method = options.method || 'POST';
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-device-id': this.state.deviceId,
      };
      if (options.captchaToken) headers['x-captcha-token'] = options.captchaToken;
      if (options.authorized) headers.Authorization = `Bearer ${await this.ensureAccessToken()}`;
      let response;
      try {
        response = await this.fetch(`${stripSlash(this.config.authBaseUrl)}${path}`, {
          method,
          headers,
          ...(method === 'GET' || options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        });
      } catch (cause) {
        const message = String(cause?.errMsg || '').trim();
        throw createSyncError('connection', message || 'The account service could not be reached', cause);
      }
      const data = await readJson(response);
      if (!response.ok) {
        const authErrorCode = getAuthErrorCode(data, response.status);
        const error = createSyncError(
          getAuthErrorType(data, response.status),
          getErrorMessage(data, `${options.fallback || 'Account request failed'} (${response.status})`)
        );
        error.authErrorCode = authErrorCode;
        error.authErrorData = data;
        throw error;
      }
      return data;
    }

    async logout() {
      if (this.syncPromise) await this.syncPromise.catch(() => {});
      const accountId = this.auth?.accountId || '';
      if (this.auth?.accessToken && this.enabled && navigatorOnLine()) {
        try {
          await this.fetch(`${stripSlash(this.config.authBaseUrl)}/auth/v1/user/signout`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.auth.accessToken}`,
              'Content-Type': 'application/json',
              'x-device-id': this.state.deviceId,
            },
            body: JSON.stringify({ client_id: this.config.environmentId }),
          });
        } catch {
          // Local sign-out must still work when the auth service is unavailable.
        }
      }
      if (accountId) {
        delete this.accounts.sessions[accountId];
      }
      this.accounts.activeAccountId = '';
      this.auth = null;
      await this.save();
      this.emitStatus('signed-out');
    }

    async ensureAccessToken() {
      if (!this.auth) throw new Error('Sign in to sync');
      if (!isTrustedSession(this.auth, this.now())) {
        expireSession(this.auth);
        this.auth = null;
        this.accounts.activeAccountId = '';
        await this.save();
        throw new Error('Your trusted session expired. Sign in again.');
      }
      if (this.auth.accessToken && Number(this.auth.expiresAt || 0) > this.now() + 60000) {
        return this.auth.accessToken;
      }
      if (!this.auth.refreshToken) throw new Error('Your session expired. Sign in again.');
      const response = await this.fetch(`${stripSlash(this.config.authBaseUrl)}/auth/v1/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': this.state.deviceId,
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: this.auth.refreshToken,
          client_id: this.config.environmentId,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || !data.access_token) {
        const expiredAccountId = this.auth.accountId;
        expireSession(this.accounts.sessions[expiredAccountId]);
        this.auth = null;
        this.accounts.activeAccountId = '';
        await this.save();
        throw new Error(getErrorMessage(data, 'Your session expired. Sign in again.'));
      }
      this.auth.accessToken = data.access_token;
      this.auth.refreshToken = data.refresh_token || this.auth.refreshToken;
      this.auth.expiresAt = this.now() + Number(data.expires_in || 7200) * 1000;
      await this.save();
      return this.auth.accessToken;
    }

    async api(path, options = {}) {
      const token = await this.ensureAccessToken();
      const response = await this.fetch(`${stripSlash(this.config.apiBaseUrl)}${path}`, {
        ...options,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-device-id': this.state.deviceId,
          ...(options.headers || {}),
        },
      });
      const data = await readJson(response);
      this.updateServerClock(data.serverTime);
      if (!response.ok) {
        const error = createSyncError(
          getSyncApiErrorType(data, response.status),
          getErrorMessage(data, `Sync request failed (${response.status})`)
        );
        error.retryable = Boolean(data?.retryable || Number(response.status) >= 500);
        error.operationId = data?.operationId || '';
        throw error;
      }
      return data;
    }

    async sync(workspace, options = {}) {
      if (this.syncPromise) return this.syncPromise;
      const input = contract.clone(workspace);
      this.syncPromise = (async () => {
        await this.captureWorkspace(input);
        return this.performSync(input, options);
      })()
        .catch(async error => {
          // Cursor/version progress stays private until the workspace has been saved.
          // Keep the immutable sent operations AND any newer edits for an idempotent retry.
          await this.save();
          throw error;
        })
        .finally(() => { this.syncPromise = null; this.syncProgress = null; });
      return this.syncPromise;
    }

    async performSync(workspaceInput, options = {}) {
      if (!this.enabled) return { workspace: workspaceInput, changed: false, state: this.getPublicState() };
      if (!this.auth) throw new Error('Sign in to sync');
      if (!navigatorOnLine()) {
        this.emitStatus('offline');
        throw new Error('You are offline');
      }

      this.emitStatus('syncing');
      this.syncProgress = { cursor: this.state.cursor, versions: contract.clone(this.state.versions) };
      const scheduledIds = new Set(this.state.queue.map(operation => operation.opId));
      let workspace = contract.clone(workspaceInput);
      let changed = false;
      const summary = { uploaded: 0, downloaded: 0, autoResolved: 0, conflicts: 0 };
      const pulledRevisions = new Set();
      const uploadedRevisions = new Set();

      const initialPull = await this.pullRemoteChanges(workspace, summary, true, pulledRevisions);
      workspace = initialPull.workspace;
      changed ||= initialPull.changed;

      while (this.state.queue.some(operation => scheduledIds.has(operation.opId))) {
        const batch = this.state.queue.filter(operation => scheduledIds.has(operation.opId) && !operation.dependsOnOpId).slice(0, 50);
        if (!batch.length) break;
        // Persist before sending: a lost acknowledgement must retry exactly the same opId/payload.
        batch.forEach(operation => { operation.sent = true; });
        const operations = contract.clone(batch.map(({ entityKey: ignored, sent, dependsOnOpId, ...operation }) => operation));
        await this.save();
        const result = await this.api('/push', {
          method: 'POST',
          body: JSON.stringify({ deviceId: this.state.deviceId, operations }),
        });
        const accepted = result.accepted || [];
        const acceptedIds = new Set(accepted.map(item => item.opId || item));
        const conflictIds = new Set((result.conflicts || []).map(item => item.opId));
        for (const acceptedResult of accepted) {
          const localOperation = operations.find(operation => operation.opId === (acceptedResult.opId || acceptedResult));
          if (acceptedResult.outcome === 'remote_won' && acceptedResult.remote) {
            this.rememberRecovery(localOperation, 'local', 'Remote version was modified later');
            workspace = contract.applyEntityChange(workspace, acceptedResult.remote);
            const key = contract.entityKey(acceptedResult.remote.entityType, acceptedResult.remote.entityId);
            this.syncProgress.versions[key] = Number(acceptedResult.remote.version || 0);
            summary.autoResolved += 1;
            changed = true;
          } else {
            summary.uploaded += 1;
            const revision = Number(acceptedResult?.revision || 0);
            if (revision > 0) uploadedRevisions.add(revision);
          }
          if (localOperation) {
            const key = contract.entityKey(localOperation.entityType, localOperation.entityId);
            const version = Number(acceptedResult.version || acceptedResult.remote?.version || this.syncProgress.versions[key] || 0);
            this.syncProgress.versions[key] = version;
            for (const pending of this.state.queue) {
              if (pending.dependsOnOpId !== localOperation.opId) continue;
              pending.baseVersion = version;
              delete pending.dependsOnOpId;
            }
          }
        }
        this.state.queue = this.state.queue.filter(operation => !acceptedIds.has(operation.opId) && !conflictIds.has(operation.opId));
        for (const conflict of result.conflicts || []) {
          const localOperation = operations.find(operation => operation.opId === conflict.opId);
          this.state.conflicts.push({
            id: conflict.conflictId || contract.createId('conflict'),
            entityType: conflict.entityType,
            entityId: conflict.entityId,
            local: contract.clone(localOperation?.payload),
            remote: contract.clone(conflict.remote),
            createdAt: conflict.createdAt || this.nowIso(),
          });
          if (conflict.remote) {
            workspace = contract.applyEntityChange(workspace, conflict.remote);
            const key = contract.entityKey(conflict.entityType, conflict.entityId);
            this.syncProgress.versions[key] = Number(conflict.remote.version || 0);
            changed = true;
          }
          summary.conflicts += 1;
          for (const pending of this.state.queue) {
            if (pending.dependsOnOpId !== conflict.opId) continue;
            pending.baseVersion = Number(conflict.remote?.version || 0);
            delete pending.dependsOnOpId;
          }
        }
        if (!acceptedIds.size && !conflictIds.size) break;
      }

      const confirmationPull = await this.pullRemoteChanges(workspace, summary, true, pulledRevisions, false);
      workspace = confirmationPull.workspace;
      changed ||= confirmationPull.changed;
      summary.downloaded += [...pulledRevisions]
        .filter(revision => !uploadedRevisions.has(revision)).length;

      const liveWorkspace = options.getWorkspace ? options.getWorkspace() : this.latestWorkspace;
      let captured;
      if (liveWorkspace) {
        captured = this.captureWorkspace(liveWorkspace);
        workspace = contract.rebaseWorkspace(workspaceInput, liveWorkspace, workspace);
      }
      this.state.baseline = contract.workspaceToEntityMap(workspace);
      this.latestWorkspace = contract.clone(workspace);
      try {
        if (options.applyWorkspace) await options.applyWorkspace(workspace);
      } catch (error) {
        // A failed disk write must not make an unapplied download the next baseline.
        // Retain edits captured during that write, without mistaking the download for them.
        this.latestWorkspace = contract.rebaseWorkspace(workspace, this.latestWorkspace, liveWorkspace || workspaceInput);
        this.state.baseline = contract.workspaceToEntityMap(this.latestWorkspace);
        await captured;
        throw error;
      }
      await captured;
      this.state.cursor = this.syncProgress.cursor;
      this.state.versions = this.syncProgress.versions;
      this.state.lastSyncedAt = this.nowIso();
      this.state.lastSyncSummary = summary;
      await this.save();
      this.emitStatus(this.state.conflicts.length ? 'conflict' : this.state.queue.length ? 'pending' : 'synced');
      return { workspace, changed, summary, state: this.getPublicState() };
    }

    async pullRemoteChanges(workspaceInput, summary, preserveQueued, pulledRevisions = new Set(), replaceInitialSeed = true) {
      let workspace = workspaceInput;
      let changed = false;
      let hasMore = true;
      const latestRemote = new Map();
      while (hasMore) {
        const result = await this.api('/pull', {
          method: 'POST',
          body: JSON.stringify({ cursor: this.syncProgress.cursor, limit: 200 }),
        });
        for (const change of result.changes || []) {
          const key = contract.entityKey(change.entityType, change.entityId);
          latestRemote.set(key, change);
          const queuedIndex = this.state.queue.findIndex(operation => operation.entityKey === key);
          const queuedOperation = queuedIndex >= 0 ? this.state.queue[queuedIndex] : null;
          const revision = Number(change.revision || 0);
          if (revision > 0) pulledRevisions.add(revision);
          else summary.downloaded += 1;
          this.syncProgress.versions[key] = Number(change.version || 0);

          if (preserveQueued && queuedOperation && (!queuedOperation.initialSeed || !replaceInitialSeed || queuedOperation.sent || this.state.queue.some(operation => operation.dependsOnOpId === queuedOperation.opId))) continue;
          if (preserveQueued && queuedOperation?.initialSeed) {
            this.rememberRecovery(queuedOperation, 'local', 'Initial local copy was replaced by cloud data');
            this.state.queue.splice(queuedIndex, 1);
            summary.autoResolved += 1;
          }
          workspace = contract.applyEntityChange(workspace, change);
          changed = true;
        }
        this.syncProgress.cursor = Number(result.cursor ?? this.syncProgress.cursor);
        hasMore = Boolean(result.hasMore);
      }
      // Compare only after every page: an earlier matching revision may be
      // followed by a different value or tombstone. Never drop an uncertain
      // sent operation or its successors; those require an idempotent receipt.
      if (preserveQueued && replaceInitialSeed) {
        this.state.queue = this.state.queue.filter(operation => {
          const remote = latestRemote.get(operation.entityKey);
          if (!remote || operation.sent || operation.dependsOnOpId ||
              this.state.queue.some(other => other.dependsOnOpId === operation.opId)) return true;
          const equal = operation.action === 'delete'
            ? Boolean(remote.deletedAt)
            : !remote.deletedAt && contract.entitiesEqual(operation.payload, remote.payload);
          return !equal;
        });
      }
      return { workspace, changed };
    }

    rememberRecovery(operation, source, reason) {
      if (!operation) return;
      const createdAt = this.nowIso();
      const expiresAt = new Date(Date.parse(createdAt) + 30 * 24 * 60 * 60 * 1000).toISOString();
      this.state.recoveryHistory = (this.state.recoveryHistory || [])
        .filter(item => Date.parse(item.expiresAt || 0) > this.now())
        .slice(-99);
      this.state.recoveryHistory.push({
        id: contract.createId('recovery'),
        source,
        reason,
        entityType: operation.entityType,
        entityId: operation.entityId,
        payload: contract.clone(operation.payload),
        clientModifiedAt: operation.clientModifiedAt || operation.queuedAt || '',
        deviceId: operation.deviceId || '',
        createdAt,
        expiresAt,
      });
    }

    updateServerClock(serverTime) {
      const parsed = Date.parse(serverTime || '');
      if (Number.isFinite(parsed)) this.state.clockOffsetMs = parsed - this.now();
    }

    nowIso() {
      return new Date(this.now() + Number(this.state?.clockOffsetMs || 0)).toISOString();
    }

    async getServerStatus() {
      if (!this.auth) return null;
      return this.api('/status', { method: 'GET' });
    }

    async resolveConflict(conflictId, resolution, workspaceInput) {
      const conflictIndex = this.state.conflicts.findIndex(item => item.id === conflictId);
      if (conflictIndex < 0) return workspaceInput;
      const conflict = this.state.conflicts[conflictIndex];
      await this.api('/conflicts/resolve', {
        method: 'POST',
        body: JSON.stringify({ conflictId, resolution }),
      });
      let workspace = contract.clone(workspaceInput);
      if (resolution === 'remote') {
        workspace = contract.applyEntityChange(workspace, conflict.remote);
        const key = contract.entityKey(conflict.entityType, conflict.entityId);
        this.state.versions[key] = Number(conflict.remote?.version || 0);
        this.state.baseline = contract.workspaceToEntityMap(workspace);
      } else {
        const key = contract.entityKey(conflict.entityType, conflict.entityId);
        this.state.versions[key] = Number(conflict.remote?.version || 0);
        const entity = {
          type: conflict.entityType,
          id: conflict.entityId,
          payload: contract.clone(conflict.local),
        };
        this.state.queue.push({
          opId: contract.createId('op'),
          deviceId: this.state.deviceId,
          entityKey: key,
          entityType: conflict.entityType,
          entityId: conflict.entityId,
          baseVersion: Number(conflict.remote?.version || 0),
          action: conflict.local ? 'upsert' : 'delete',
          payload: contract.clone(conflict.local),
          clientModifiedAt: this.nowIso(),
          queuedAt: this.nowIso(),
          initialSeed: false,
        });
        this.state.baseline[key] = entity;
      }
      this.state.conflicts.splice(conflictIndex, 1);
      await this.save();
      return workspace;
    }
  }

  function navigatorOnLine() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  function stripSlash(value) {
    return String(value || '').replace(/\/$/, '');
  }

  function normalizeContact(kind, value) {
    const normalizedKind = String(kind || '').trim();
    const normalizedValue = String(value || '').trim();
    if (normalizedKind === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedValue)) throw new Error('Enter a valid email address');
      return { email: normalizedValue.toLowerCase() };
    }
    if (normalizedKind === 'phone') {
      const digits = normalizedValue.replace(/\D/g, '');
      const mainland = digits.startsWith('86') ? digits.slice(2) : digits;
      if (!/^1\d{10}$/.test(mainland)) throw new Error('Enter a valid mainland China phone number');
      return { phone_number: `+86 ${mainland}` };
    }
    throw new Error('Select phone or email');
  }

  function normalizeOptionalUsername(value) {
    const username = String(value || '').trim();
    if (username && !/^[A-Za-z0-9][A-Za-z0-9._:+@ -]{1,47}$/.test(username)) {
      throw new Error('Username must be 2–48 characters and start with a letter or number');
    }
    return username;
  }

  function normalizeAccountProfile(value) {
    let profile = value && typeof value === 'object' ? value : {};
    for (let depth = 0; depth < 3; depth += 1) {
      if (profile.user && typeof profile.user === 'object') {
        profile = profile.user;
      } else if (profile.data && typeof profile.data === 'object') {
        profile = profile.data;
      } else {
        break;
      }
    }
    const email = profile.email || profile.email_address || profile.emailAddress || '';
    const phoneNumber = profile.phone_number || profile.phone || profile.phoneNumber || '';
    const avatarUrl = profile.avatar_url || profile.avatarUrl || profile.picture || '';
    return {
      ...profile,
      ...(email ? { email: String(email) } : {}),
      ...(phoneNumber ? { phone_number: String(phoneNumber) } : {}),
      ...(avatarUrl ? { avatar_url: String(avatarUrl) } : {}),
    };
  }

  function normalizeProviders(value) {
    let providers = value;
    for (let depth = 0; depth < 3; depth += 1) {
      if (Array.isArray(providers)) break;
      if (Array.isArray(providers?.data)) {
        providers = providers.data;
        break;
      }
      if (Array.isArray(providers?.providers)) {
        providers = providers.providers;
        break;
      }
      providers = providers?.data || providers?.providers || [];
    }
    return Array.isArray(providers) ? providers.filter(item => item && typeof item === 'object') : [];
  }

  function normalizeAccounts(value) {
    const sessions = value?.sessions && typeof value.sessions === 'object' ? value.sessions : {};
    return {
      version: 1,
      activeAccountId: String(value?.activeAccountId || ''),
      lastAccountId: String(value?.lastAccountId || value?.activeAccountId || ''),
      sessions: Object.fromEntries(Object.entries(sessions).map(([accountId, session]) => [
        accountId,
        { ...(session || {}), accountId },
      ])),
    };
  }

  function normalizeAccountStates(value) {
    return {
      version: 1,
      states: value?.states && typeof value.states === 'object' ? contract.clone(value.states) : {},
    };
  }

  function getAccountId(session) {
    const userId = String(session?.userId || session?.sub || '').trim();
    if (userId) return `uid:${userId}`;
    const username = String(session?.username || '').trim().toLowerCase();
    return username ? `username:${username}` : '';
  }

  function isTrustedSession(session, now) {
    if (!session || (!session.refreshToken && !session.accessToken)) return false;
    const trustedUntil = Date.parse(session.trustedUntil || '');
    return Number.isFinite(trustedUntil) && trustedUntil > Number(now);
  }

  function expireSession(session) {
    if (!session) return;
    session.accessToken = '';
    session.refreshToken = '';
    session.expiresAt = 0;
  }

  async function readJson(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { message: text }; }
  }

  function getErrorMessage(data, fallback) {
    const code = getAuthErrorCode(data);
    const friendly = {
      invalid_username_or_password: 'The username or password is incorrect.',
      invalid_credentials: 'The account credentials are invalid.',
      password_not_set: 'This account does not have a password yet.',
      captcha_required: 'A captcha is required after repeated attempts.',
      captcha_invalid: 'The captcha is invalid or expired.',
      invalid_status: 'This account is temporarily locked.',
      invalid_verification_code: 'The verification code is incorrect.',
      verification_code_expired: 'The verification code expired.',
      weak_password: 'The password does not meet the required strength.',
      user_not_found: 'No matching account was found.',
      user_already_exists: 'An account already exists for this email or username.',
      username_already_exists: 'This username is already in use.',
      email_already_exists: 'This email is already bound to another account.',
      phone_already_exists: 'An account already exists for this phone number.',
      phone_number_already_exists: 'This phone number is already bound to another account.',
      too_many_requests: 'Too many requests. Try again later.',
      rate_limit_exceeded: 'Too many requests. Try again later.',
      TOO_MANY_ATTEMPTS: 'Too many sign-in attempts. Try again later.',
      TOO_MANY_VERIFICATION_REQUESTS: 'Too many verification requests. Try again later.',
      TOO_MANY_SENSITIVE_REQUESTS: 'Too many password change attempts. Try again later.',
      RATE_LIMITED: 'Too many requests. Try again later.',
      ORIGIN_NOT_ALLOWED: 'This extension origin is not authorized.',
      AUTH_PROXY_NOT_CONFIGURED: 'The account proxy is not configured.',
      AUTH_UPSTREAM_TIMEOUT: 'The account service timed out.',
      AUTH_UPSTREAM_UNAVAILABLE: 'The account service is unavailable.',
      METHOD_NOT_ALLOWED: 'This account operation is not supported.',
      NOT_FOUND: 'The account service route was not found.',
      BODY_TOO_LARGE: 'The account request is too large.',
      invalid_email: 'Enter a valid email address.',
      invalid_phone_number: 'Enter a valid mainland China phone number.',
      email_not_verified: 'Verify the email address first.',
      phone_number_not_verified: 'Verify the phone number first.',
      unimplemented: 'The required sign-in method is not enabled for this CloudBase environment.',
      invalid_argument: 'The account request is invalid.',
      invalid_password: 'The current password is incorrect.',
      INVALID_REQUEST: 'The account request is invalid.',
    };
    return friendly[code] || data?.error_description || data?.error?.message || data?.message || code || fallback;
  }

  function getAuthErrorType(data, status) {
    const code = getAuthErrorCode(data, status);
    if (['invalid_username_or_password', 'invalid_credentials', 'invalid_password', 'password_not_set'].includes(code)) return 'credentials';
    if (['captcha_required', 'captcha_invalid', 'invalid_status', 'invalid_verification_code', 'verification_code_expired'].includes(code)) return 'account';
    if (code === 'unimplemented') return 'configuration';
    if (Number(status) >= 500) return 'server';
    if (Number(status) === 401 || Number(status) === 403) return 'permission';
    return 'account';
  }

  function getAuthErrorCode(data, status = 0) {
    const nested = data?.error && typeof data.error === 'object' ? data.error : null;
    const code = typeof data?.error === 'string'
      ? data.error
      : data?.code || data?.error_code_name || nested?.code || nested?.error || '';
    if (code) return String(code);
    if (Number(status) === 404) return 'NOT_FOUND';
    if (Number(status) === 405) return 'METHOD_NOT_ALLOWED';
    if (Number(status) === 429) return 'RATE_LIMITED';
    return '';
  }

  function getSyncApiErrorType(data, status) {
    const code = typeof data?.error === 'string' ? data.error : data?.code;
    if (code === 'SYNC_VALIDATION_ERROR' || Number(status) === 400 || Number(status) === 422) return 'data';
    if (Number(status) === 401 || Number(status) === 403) return 'permission';
    if (code === 'SYNC_STORAGE_BUSY' || code === 'SYNC_STORAGE_ERROR' || Number(status) >= 500) return 'server';
    return 'connection';
  }

  function getTokenIssuedAt(token) {
    const payload = String(token || '').split('.')[1];
    if (!payload) return '';
    try {
      const normalized = payload.replaceAll('-', '+').replaceAll('_', '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      const json = typeof atob === 'function'
        ? decodeURIComponent(Array.from(atob(padded), char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''))
        : Buffer.from(payload, 'base64url').toString('utf8');
      const issuedAt = Number(JSON.parse(json)?.iat || 0);
      return issuedAt > 0 ? new Date(issuedAt * 1000).toISOString() : '';
    } catch {
      return '';
    }
  }

  function createSyncError(type, message, cause) {
    const error = new Error(message, cause ? { cause } : undefined);
    error.syncErrorType = type;
    return error;
  }

  return { TabOutSyncClient };
});
