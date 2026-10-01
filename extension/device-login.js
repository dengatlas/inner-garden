/* Page displays authorization identifiers; only the worker handles credentials. */
'use strict';
let workspaceDeviceLogin = null;
let workspaceDeviceLoginTimer = null;
let workspaceDeviceLoginError = '';
let workspaceDeviceLoginGeneration = 0;

function renderDeviceLoginQRCode(userCode) {
  const text = JSON.stringify({ protocol: 'inner-garden-device-login-v1',
    environmentId: getWorkspaceSyncConfig().environmentId, userCode });
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const size = qr.size + 8, path = [];
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
    if (qr.getModule(x, y)) path.push(`M${x + 4},${y + 4}h1v1h-1z`);
  }
  return `<svg class="sync-device-qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="手机授权电脑二维码" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><path d="${path.join(' ')}" fill="black"/></svg>`;
}

function renderDeviceLoginPanel() {
  const c = workspaceDeviceLogin;
  const expired = c && (c.status === 'expired' || Date.now() >= c.expiresAt);
  const authorized = c?.status === 'authorized' && !expired;
  let content;
  if (authorized) {
    content = `<div class="sync-device-account"><strong>手机已授权，请核对账号</strong><p>${escapeHtml(c.label)}</p><p>账号 UID：<code>${escapeHtml(c.userId)}</code></p><p>与手机账号页显示的 UID 相同，才是同一个账号。昵称不能用来判断。</p><button class="sync-button" type="button" data-action="confirm-device-login">确认这个账号并同步日程</button><p class="sync-field-help">flomo 需要另行开启账号笔记库并同步。</p></div>`;
  } else if (c?.status === 'waiting' && !expired) {
    const seconds = Math.max(0, Math.ceil((c.expiresAt - Date.now()) / 1000));
    content = `${renderDeviceLoginQRCode(c.userCode)}<div class="sync-device-code">授权编号：<code>${escapeHtml(c.userCode)}</code></div><p class="sync-dialog-note">请在小程序账号页点“授权电脑”，扫码或输入编号，然后确认当前账号。二维码还剩约 ${seconds} 秒。</p>`;
  } else {
    content = `<p class="sync-dialog-note">${expired ? '授权已过期，请重新生成。' : c?.status === 'denied' ? '授权已取消，可重新生成。' : '打开美日心灵小程序 → 设置 → 账号 → 授权电脑。手机使用当前登录的账号授权，不需要设置密码。'}</p>`;
  }
  return `<div class="sync-device-login" aria-live="polite">${content}
    ${workspaceDeviceLoginError ? renderAccountFeedback('手机授权尚未完成', workspaceDeviceLoginError, '请重试', 'error') : ''}
    <div class="sync-device-actions"><button class="sync-button subtle" type="button" data-action="start-device-login">${c ? '重新生成授权二维码' : '生成授权二维码'}</button>${c ? '<button class="sync-button subtle" type="button" data-action="cancel-device-login">取消授权</button>' : ''}</div>
    <p class="sync-field-help">请使用小程序账号页内的扫码入口。电脑只在你核对后登录并同步；不会自动合并不同账号。</p></div>`;
}

function deviceLoginPanelIsOpen() {
  return document.getElementById('workspaceSyncDialog')?.open && workspaceAccountLoginMethod === 'phone-device'
    && ['login', 'add-account'].includes(workspaceAccountView);
}

function clearDeviceLogin() {
  workspaceDeviceLoginGeneration += 1;
  if (workspaceDeviceLoginTimer) clearTimeout(workspaceDeviceLoginTimer);
  workspaceDeviceLoginTimer = null;
  const id = workspaceDeviceLogin?.id;
  workspaceDeviceLogin = null; workspaceDeviceLoginError = '';
  if (id) workspaceSyncClient?.cancelDeviceLogin(id).catch(() => {});
}

function scheduleDeviceLoginPoll(generation) {
  workspaceDeviceLoginTimer = setTimeout(async () => {
    if (generation !== workspaceDeviceLoginGeneration) return;
    if (!deviceLoginPanelIsOpen()) { clearDeviceLogin(); return; }
    const c = workspaceDeviceLogin;
    if (!c?.id || c.status !== 'waiting') return;
    try {
      const next = await workspaceSyncClient.pollDeviceLogin(c.id);
      if (generation !== workspaceDeviceLoginGeneration) return;
      workspaceDeviceLogin = next; workspaceDeviceLoginError = '';
    } catch (error) {
      if (generation !== workspaceDeviceLoginGeneration) return;
      workspaceDeviceLoginError = getDeviceLoginError(error);
    }
    renderWorkspaceSyncDialog();
    if (workspaceDeviceLogin?.status === 'waiting') scheduleDeviceLoginPoll(generation);
  }, Math.max(5000, workspaceDeviceLogin?.intervalMs || 5000));
}

function getDeviceLoginError(error) {
  if (['NOT_FOUND', 'METHOD_NOT_ALLOWED'].includes(error.authErrorCode)) return '账号服务尚未开放手机授权入口，请联系维护者完成配置。';
  return /[\u3400-\u9fff]/u.test(String(error.message || '')) ? error.message : '暂时无法连接手机授权服务，请稍后重试。';
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  const action = button?.dataset.action;
  if (action === 'select-login-method' && button.dataset.method !== 'phone-device') clearDeviceLogin();
  if (!['start-device-login', 'cancel-device-login', 'confirm-device-login'].includes(action)) return;
  if (action === 'cancel-device-login') { clearDeviceLogin(); renderWorkspaceSyncDialog(); return; }
  button.disabled = true;
  try {
    if (action === 'start-device-login') {
      clearDeviceLogin(); const generation = workspaceDeviceLoginGeneration;
      if (!await ensureWorkspaceSyncHostPermission(true)) throw new Error('请先允许访问账号服务域名。');
      const challenge = await workspaceSyncClient.startDeviceLogin();
      if (generation !== workspaceDeviceLoginGeneration || !deviceLoginPanelIsOpen()) {
        if (challenge.id) await workspaceSyncClient.cancelDeviceLogin(challenge.id);
        return;
      }
      workspaceDeviceLogin = challenge;
      renderWorkspaceSyncDialog(); scheduleDeviceLoginPoll(generation);
    } else {
      const c = workspaceDeviceLogin;
      await flushWeeklyWorkspaceSave();
      await workspaceSyncClient.confirmDeviceLogin(c?.id, c?.userId);
      workspaceDeviceLogin = null;
      clearDeviceLogin(); workspaceAccountProfile = null; workspaceAccountView = 'account';
      renderWorkspaceSyncDialog();
      showToast('账号已登录，正在同步日程；flomo 可另行同步。', 4500);
      await performWorkspaceSync(false);
    }
  } catch (error) {
    workspaceDeviceLoginError = getDeviceLoginError(error);
    if (deviceLoginPanelIsOpen()) renderWorkspaceSyncDialog();
    else showToast(workspaceDeviceLoginError, 4500);
  } finally { button.disabled = false; }
});

document.addEventListener('close', event => {
  if (event.target.id === 'workspaceSyncDialog') clearDeviceLogin();
}, true);
window.addEventListener('pagehide', clearDeviceLogin);
