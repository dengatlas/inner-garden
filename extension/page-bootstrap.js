/* Load page modules after the worker has finalized optional local configuration.
 * A missing config.local.js is handled only by the worker, never by an HTML request. */
(async () => {
  'use strict';
  chrome.runtime.onMessage.addListener(message => {
    if (message?.channel === 'inner-garden-device-imported') location.reload();
  });
  try {
    const response = await chrome.runtime.sendMessage({ channel: 'inner-garden-public-config' });
    if (!response?.ok) throw new Error(response?.error || '后台配置未响应');
    globalThis.TAB_OUT_SYNC_CONFIG = Object.freeze({ ...globalThis.TAB_OUT_SYNC_CONFIG, ...response.config });
  } catch (error) {
    console.warn('[inner-garden] 使用内置配置：', error.message);
  }
  for (const source of [
    'local-favicon.js', 'shared/workspace-sync.js', 'shared/sync-client.js',
    'shared/workspace-browser-client.js', 'vendor/qrcodegen.js', 'device-login.js', 'app.js', 'shared/flomo.js',
    'flomo-editor-tools.js', 'flomo-channel.js', 'flomo.js',
  ]) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = source;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`未能加载 ${source}`));
      document.body.append(script);
    });
  }
})().catch(error => {
  console.error('[inner-garden] 初始化失败：', error);
  const status = document.getElementById('workspaceSyncStatus');
  if (status) status.textContent = '页面加载未完成，请重新加载扩展后再打开新标签页。';
});
