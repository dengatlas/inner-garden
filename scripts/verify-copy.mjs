import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse((await readFile(join(root, 'COPY_BASELINE.json'), 'utf8')).replace(/^\uFEFF/, ''));
const entries = Array.isArray(baseline) ? baseline : baseline.files;
const extension = join(root, 'extension');
const failures = [];

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) files.push(relative);
    else failures.push(`Unsupported filesystem entry: ${relative}`);
  }
  return files;
}

const actual = new Set(await listFiles(extension));
for (const entry of entries) {
  if (!actual.delete(entry.path)) {
    failures.push(`Missing: ${entry.path}`);
    continue;
  }
  const data = await readFile(join(extension, ...entry.path.split('/')));
  const digest = createHash('sha256').update(data).digest('hex');
  if (data.length !== entry.bytes || digest !== entry.sha256.toLowerCase()) failures.push(`Changed: ${entry.path}`);
}
for (const relative of actual) failures.push(`Extra: ${relative}`);
if (failures.length) {
  console.error(failures.join('\n'));
  console.error('Historical copy differs. Intentional development changes do not imply a failed release.');
  process.exitCode = 1;
} else {
  console.log(`PASS: ${entries.length} files, ${entries.reduce((sum, entry) => sum + entry.bytes, 0)} bytes; SHA-256 matches the original copy baseline.`);
}
