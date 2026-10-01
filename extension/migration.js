'use strict';

const migration = globalThis.InnerGardenDeviceMigration;
const statusEl = document.getElementById('status');

async function migrationRequest(method, payload) {
  const response = await chrome.runtime.sendMessage({ channel: 'inner-garden-device-migration', method, payload });
  if (!response?.ok) throw new Error(response?.error || '插件后台未响应，请重新加载后重试');
  return response.result;
}

function setStatus(message, kind = 'ok') {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
}

function downloadJson(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('exportMigration').addEventListener('click', async () => {
  try {
    const data = await migrationRequest('export');
    const date = new Date().toISOString().slice(0, 10);
    downloadJson({ schema: migration.schema, exportedAt: new Date().toISOString(), sourceExtensionId: chrome.runtime.id, data }, `inner-garden-device-migration-${date}.json`);
    setStatus('迁移包已导出。请妥善保管，其中包含你的本机内容。');
  } catch (error) {
    setStatus(`导出失败：${error.message}`, 'error');
  }
});

document.getElementById('migrationFile').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    migration.validatePayload(payload);
    await migrationRequest('import', payload);
    setStatus('导入完成。请重新打开新标签页，使用对应账号登录并点击“立即同步”。');
    event.target.value = '';
  } catch (error) {
    setStatus(`导入失败：${error.message}`, 'error');
    event.target.value = '';
  }
});
