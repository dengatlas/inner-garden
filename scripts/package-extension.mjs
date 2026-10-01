import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { runtimeFiles, documentFiles } from './extension-files.mjs';
import { createZip, readZip } from './zip.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'extension/manifest.json'), 'utf8'));
const publicConfig = vm.createContext({});
vm.runInContext(await readFile(resolve(root, 'extension/config.js'), 'utf8'), publicConfig);
if (publicConfig.TAB_OUT_LOAD_LOCAL_CONFIG !== false || publicConfig.TAB_OUT_SYNC_CONFIG.defaultUsername) {
  throw new Error('Private override loading or personal username is enabled in public defaults');
}
const entries = [];
for (const [source, name] of [...runtimeFiles.map(name => [`extension/${name}`, name]), ...documentFiles]) {
  if (/config\.local|\.pem$|\.key$|(?:^|\/)(?:private|profiles|exports|backups)(?:\/|$)/i.test(name)) throw new Error(`Forbidden release file: ${name}`);
  const path = resolve(root, source);
  if (!(await lstat(path)).isFile()) throw new Error(`Release source is not a regular file: ${source}`);
  entries.push({ name, data: await readFile(path) });
}
if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw new Error('Duplicate release path');
const zip = createZip(entries);
if (readZip(zip).length !== entries.length) throw new Error('ZIP verification failed');
await mkdir(resolve(root, 'dist'), { recursive: true });
const filename = `inner-garden-${manifest.version}.zip`;
await writeFile(resolve(root, 'dist', filename), zip);
const digest = createHash('sha256').update(zip).digest('hex');
await writeFile(resolve(root, 'dist', `${filename}.sha256`), `${digest}  ${filename}\n`);
await writeFile(resolve(root, 'dist/release-files.json'), JSON.stringify({ version: manifest.version, sha256: digest, files: entries.map(({ name, data }) => ({ name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') })) }, null, 2) + '\n');
console.log(`Packaged ${filename}: ${entries.length} allowlisted files, ${zip.length} bytes. SHA-256 ${digest}`);
