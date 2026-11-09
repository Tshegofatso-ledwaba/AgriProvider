const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createLocalEvidenceStorage } = require('../src/storage/local-evidence-storage');

test('local evidence storage saves, reads, and deletes files using opaque keys', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agriprovider-evidence-'));
  const storage = createLocalEvidenceStorage({ directory });
  const content = Buffer.from('%PDF-1.4\nsynthetic test document');
  try {
    const key = await storage.save(content);
    assert.match(key, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(await storage.read(key), content);
    const storedFile = await fs.stat(path.join(directory, `${key}.blob`));
    assert.equal(storedFile.isFile(), true);

    await storage.delete(key);
    await assert.rejects(storage.read(key), { code: 'ENOENT' });
    await assert.rejects(storage.read('../escape'), /Invalid evidence storage key/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('local evidence storage removes temporary files after a failed write', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agriprovider-evidence-failure-'));
  const blockingPath = path.join(directory, 'not-a-directory');
  await fs.writeFile(blockingPath, 'file');
  const storage = createLocalEvidenceStorage({ directory: blockingPath });
  try {
    await assert.rejects(storage.save(Buffer.from('document')));
    assert.equal((await fs.readdir(directory)).length, 1);
    assert.equal(await fs.readFile(blockingPath, 'utf8'), 'file');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
