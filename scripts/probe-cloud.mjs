import { readFile, mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { resolve } from 'node:path';
const root = new URL('../', import.meta.url);
const ctx = vm.createContext({});
vm.runInContext(await readFile(new URL('extension/config.js', root), 'utf8'), ctx);
const config = ctx.TAB_OUT_SYNC_CONFIG;
const policy = JSON.parse(await readFile(new URL('docs/decisions/public-edition.json', root), 'utf8'));
const probes = [];
for (const [label, id] of [['public', policy.extensionId], ['legacy', policy.oldExtensionId]]) {
  const origin = `chrome-extension://${id}`;
  for (const [service, url, method] of [
    ['account-profile', `${config.authBaseUrl}/auth/v1/user/me`, 'GET'],
    ['workspace-status', `${config.apiBaseUrl}/status`, 'GET'],
    ['flomo-pull', `${config.flomoApiBaseUrl}/pull`, 'POST'],
  ]) {
    try {
      const response = await fetch(url, {
        method, headers: { Origin: origin, Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(20000),
      });
      const body = await response.json().catch(() => ({}));
      probes.push({ label, origin, service, status: response.status,
        code: body.error?.code || body.error_code || body.code || body.error || '',
        message: body.error?.message || body.message || '',
        allowedOrigin: response.headers.get('access-control-allow-origin') || '',
      });
    } catch (error) { probes.push({ label, origin, service, error: error.message }); }
  }
}
const result = { checkedAt: new Date().toISOString(), authenticated: false, dataWritten: false, probes };
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/cloud-probe.json', root), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
