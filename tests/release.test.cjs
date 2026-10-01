const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { workerHarness, root } = require('./worker-harness.cjs');
const path = require('node:path');

test('public worker configuration excludes unknown private override fields', async () => {
  const worker = workerHarness({}, { secret: 'synthetic-private-field', pollIntervalMs: 1 });
  const response = await worker.message({ channel: 'inner-garden-public-config' });
  assert.equal(response.ok, true); assert.equal(response.config.secret, undefined);
  assert.equal(response.config.pollIntervalMs, 720000);
  assert.equal(response.config.enabled, true); assert.equal(response.config.defaultUsername, '');
  assert.ok(response.config.flomoApiBaseUrl.endsWith('/flomo/v1'));
});

test('public configuration retains all three existing-service endpoints after partial overrides', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'extension/config.js'), 'utf8'), ctx);
  ctx.TAB_OUT_SYNC_CONFIG = { enabled: false, pollIntervalMs: 2 };
  vm.runInContext(fs.readFileSync(path.join(root, 'extension/config-finalize.js'), 'utf8'), ctx);
  assert.equal(ctx.TAB_OUT_SYNC_CONFIG.enabled, false); assert.equal(ctx.TAB_OUT_SYNC_CONFIG.pollIntervalMs, 720000);
  assert.ok(ctx.TAB_OUT_SYNC_CONFIG.flomoApiBaseUrl.endsWith('/flomo/v1'));
});

test('ZIP supports binary/fonts, Unicode and empty files with corruption detection', async () => {
  const { createZip, readZip } = await import('../scripts/zip.mjs');
  const entries = [{ name: 'manifest.json', data: Buffer.from('{}') }, { name: 'fonts/字体.ttf', data: Buffer.from([0, 255, 1, 2]) }, { name: 'empty', data: Buffer.alloc(0) }];
  const zip = createZip(entries);
  assert.deepEqual(readZip(zip), entries);
  const corrupted = Buffer.from(zip); corrupted[14] ^= 1;
  assert.throws(() => readZip(corrupted), /Corrupt/);
  assert.throws(() => createZip([{ name: '../private', data: Buffer.alloc(0) }]), /Unsafe/);
});

test('release allowlist contains every runtime script and applicable licenses but no local config', async () => {
  const { runtimeFiles, documentFiles } = await import('../scripts/extension-files.mjs');
  assert.equal(runtimeFiles.some(file => /config\.local|private|profile|\.pem$/.test(file)), false);
  assert.ok(runtimeFiles.includes('fonts/DM-Sans-OFL.txt'));
  assert.ok(runtimeFiles.includes('fonts/Newsreader-OFL.txt'));
  assert.ok(runtimeFiles.includes('licenses/Heroicons-MIT.txt'));
  assert.ok(documentFiles.some(([source]) => source === 'LICENSE'));
});
