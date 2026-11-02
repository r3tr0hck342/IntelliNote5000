// Downloads the pinned transcription models for tests (golden WER) into a directory, verifying every
// archive against src-tauri/transcription-models.json before extracting. The app has its own
// installer (src-tauri/src/transcription/models.rs); this is for CI and local test runs only.
// Usage: node tools/fetch-test-models.mjs <dir>
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(path.join(repoRoot, 'src-tauri', 'transcription-models.json'), 'utf-8'));
const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node tools/fetch-test-models.mjs <dir>');
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

const sha256 = async (file) => {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
};

for (const [id, model] of Object.entries(catalog.models)) {
  const firstFile = Object.values(model.files)[0].name;
  const installed = model.archiveRoot ? path.join(dir, model.archiveRoot, firstFile) : path.join(dir, firstFile);
  if (existsSync(installed)) {
    // A restored CI cache is not trusted: re-hash every file.
    for (const file of Object.values(model.files)) {
      const filePath = model.archiveRoot ? path.join(dir, model.archiveRoot, file.name) : path.join(dir, file.name);
      if ((await sha256(filePath)) !== file.sha256) throw new Error(`${id}/${file.name}: SHA-256 mismatch in cached copy`);
    }
    console.log(`${id}: present, verified`);
    continue;
  }
  const download = path.join(dir, `${id}.download`);
  console.log(`${id}: downloading ${Math.round(model.archiveBytes / 1e6)} MB`);
  const response = await fetch(model.url);
  if (!response.ok || !response.body) throw new Error(`${id}: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(download));
  const actual = await sha256(download);
  if (actual !== model.archiveSha256) throw new Error(`${id}: archive SHA-256 mismatch (${actual})`);
  if (model.archiveRoot) {
    const tar = spawnSync('tar', ['-xjf', download, '-C', dir], { stdio: 'inherit' });
    if (tar.status !== 0) throw new Error(`${id}: extraction failed`);
  } else {
    renameSync(download, installed);
  }
  for (const file of Object.values(model.files)) {
    const filePath = model.archiveRoot ? path.join(dir, model.archiveRoot, file.name) : path.join(dir, file.name);
    if ((await sha256(filePath)) !== file.sha256) throw new Error(`${id}/${file.name}: SHA-256 mismatch`);
  }
  console.log(`${id}: verified`);
}
