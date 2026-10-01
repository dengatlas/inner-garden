import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sharedFiles = Object.freeze([
  'device-migration.js', 'flomo-prompt-seed.js', 'flomo-sync.js', 'flomo-transport.js',
  'flomo.js', 'sync-client.js', 'workspace-browser-client.js', 'workspace-sync.js',
]);
await mkdir(resolve(root, 'extension/shared'), { recursive: true });
for (const file of sharedFiles) {
  const source = await readFile(resolve(root, 'shared', file), 'utf8');
  await writeFile(resolve(root, 'extension/shared', file), source.replace(/\r\n?/g, '\n'));
}
console.log(`Built ${sharedFiles.length} shared modules for extension only.`);
