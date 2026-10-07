import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { runtimeFiles, documentFiles } from './extension-files.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const assert = (condition, message) => { if (!condition) errors.push(message); };
const read = file => readFile(resolve(root, file), 'utf8');
const manifest = JSON.parse(await read('extension/manifest.json'));
const policy = JSON.parse(await read('docs/decisions/public-edition.json'));
const pkg = JSON.parse(await read('package.json'));
const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, char => String.fromCharCode(97 + parseInt(char, 16)));
assert(id === policy.extensionId && id !== policy.oldExtensionId, 'Extension identity does not match independent policy');
assert(manifest.version === policy.version && manifest.version === pkg.version, 'Version mismatch');
assert(!manifest.host_permissions?.includes('<all_urls>'), 'Unrestricted host permission');
for (const file of runtimeFiles) {
  try { assert((await lstat(resolve(root, 'extension', file))).isFile(), `Not a regular runtime file: ${file}`); }
  catch { errors.push(`Missing runtime file: ${file}`); }
}
for (const [source] of documentFiles) {
  try { await readFile(resolve(root, source)); } catch { errors.push(`Missing release document: ${source}`); }
}
let syntaxCount = 0;
async function checkScripts(directory) {
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await checkScripts(file);
    else if (/\.(?:js|mjs|cjs)$/.test(file) && !file.endsWith('config.local.js')) {
      const result = spawnSync(process.execPath, ['--check', resolve(root, file)], { encoding: 'utf8' });
      assert(result.status === 0, `Syntax: ${file}: ${result.stderr}`); syntaxCount++;
    }
  }
}
for (const dir of ['extension', 'shared', 'scripts', 'tests']) await checkScripts(dir);
for (const entry of await readdir(resolve(root, 'shared'))) {
  assert((await read(`shared/${entry}`)).replace(/\r\n?/g, '\n') === await read(`extension/shared/${entry}`), `Generated copy stale: ${entry}`);
}
let referenceCount = 0;
async function reference(from, target) {
  if (!target || /^(?:[a-z]+:|#|\/\/)/i.test(target)) return;
  const file = resolve(root, 'extension', dirname(from), target.split(/[?#]/)[0]);
  referenceCount++;
  try { await readFile(file); } catch { errors.push(`Missing reference: ${from} -> ${target}`); }
}
for (const file of ['index.html', 'migration.html']) {
  const content = await read(`extension/${file}`);
  assert(!/\son\w+\s*=/.test(content), `Inline event handler in ${file}`);
  assert(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(content), `Remote font reference in ${file}`);
  for (const match of content.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)) await reference(file, match[1]);
}
for (const file of ['style.css', 'flomo.css', 'migration.css', 'fonts/fonts.css']) {
  const content = await read(`extension/${file}`);
  for (const match of content.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) await reference(file, (match[1] ?? match[2] ?? match[3]).trim());
}
for (const match of (await read('extension/background.js')).matchAll(/importScripts\(([^)]+)\)/g)) {
  for (const part of match[1].matchAll(/['"]([^'"]+)['"]/g)) if (part[1] !== 'config.local.js') await reference('background.js', part[1]);
}
for (const match of (await read('extension/page-bootstrap.js')).matchAll(/['"]((?:(?:shared|vendor)\/)?[\w-]+\.js)['"]/g)) await reference('page-bootstrap.js', match[1]);
for (const target of [manifest.background.service_worker, manifest.chrome_url_overrides.newtab, manifest.options_page, ...Object.values(manifest.icons)]) await reference('manifest.json', target);
const app = await read('extension/app.js');
assert(!/google\.com\/s2\/favicons|onerror\s*=/.test(app), 'Remote favicon or inline handler remains');
const configContext = vm.createContext({});
for (const file of ['config.js', 'config-finalize.js']) vm.runInContext(await read(`extension/${file}`), configContext);
const config = configContext.TAB_OUT_SYNC_CONFIG;
assert(configContext.TAB_OUT_LOAD_LOCAL_CONFIG === false, 'Private override loading enabled in public source');
assert(config.enabled === true && config.environmentId === policy.environmentId, 'Selected existing-service policy changed');
assert(!config.defaultUsername, 'Personal username in public defaults');
assert(config.pollIntervalMs === 720000 && ['authBaseUrl', 'apiBaseUrl', 'flomoApiBaseUrl'].every(key => /^https:\/\//.test(config[key])), 'Cloud endpoints or interval invalid');
const fonts = JSON.parse(await read('docs/font-assets.json'));
for (const asset of fonts.assets) assert(createHash('sha256').update(await readFile(resolve(root, 'extension/fonts', asset.file))).digest('hex') === asset.sha256, `Font asset differs: ${asset.file}`);
const qrAsset = JSON.parse(await read('docs/qr-assets.json'));
assert(createHash('sha256').update(await readFile(resolve(root, 'extension', qrAsset.file))).digest('hex') === qrAsset.sha256, 'Bundled QR asset differs from reviewed upstream');
for (const file of ['README.md', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', ...(await readdir(resolve(root, 'docs'))).filter(name => name.endsWith('.md')).map(name => `docs/${name}`)]) {
  const content = await read(file);
  assert(!/[ \t]+$/m.test(content), `Trailing whitespace: ${file}`);
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:|^#/.test(target)) continue;
    try { await readFile(resolve(root, dirname(file), target)); } catch { errors.push(`Broken document link: ${file} -> ${target}`); }
  }
}
const flomoHashes=JSON.parse(await read('docs/flomo-contract.json'));
for(const [file,hash] of Object.entries(flomoHashes.files))assert(createHash('sha256').update((await read('shared/'+file)).replace(/\r\n?/g,'\n')).digest('hex')===hash,`flomo contract drift: ${file}`);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`PASS: ${syntaxCount} JS syntax checks, ${referenceCount} local references, canonical copies, identity/configuration/font integrity and document links.`);
