const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const storageKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createLocalEvidenceStorage({
  directory = process.env.EVIDENCE_STORAGE_DIR
    ? path.resolve(__dirname, '..', '..', process.env.EVIDENCE_STORAGE_DIR)
    : path.resolve(__dirname, '..', '..', '.local-evidence'),
} = {}) {
  const root = path.resolve(directory);

  function resolveKey(storageKey) {
    if (!storageKeyPattern.test(storageKey)) {
      throw new Error('Invalid evidence storage key.');
    }
    const filePath = path.resolve(root, `${storageKey}.blob`);
    if (!filePath.startsWith(`${root}${path.sep}`)) {
      throw new Error('Evidence storage key is outside the configured directory.');
    }
    return filePath;
  }

  async function ensureDirectory() {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    await fs.chmod(root, 0o700);
  }

  return {
    provider: 'local-development',

    async save(buffer) {
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('Evidence storage requires non-empty file data.');
      }

      await ensureDirectory();
      const storageKey = randomUUID();
      const destination = resolveKey(storageKey);
      const temporary = path.join(root, `.tmp-${randomUUID()}`);
      try {
        await fs.writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, destination);
        await fs.chmod(destination, 0o600);
        return storageKey;
      } catch (error) {
        try {
          await fs.unlink(temporary);
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') {
            console.error('Temporary evidence file cleanup failed:', cleanupError.code || cleanupError.name);
          }
        }
        try {
          await fs.unlink(destination);
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') {
            console.error('Stored evidence cleanup failed:', cleanupError.code || cleanupError.name);
          }
        }
        throw error;
      }
    },

    async read(storageKey) {
      return fs.readFile(resolveKey(storageKey));
    },

    async delete(storageKey) {
      try {
        await fs.unlink(resolveKey(storageKey));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    },
  };
}

module.exports = { createLocalEvidenceStorage };
