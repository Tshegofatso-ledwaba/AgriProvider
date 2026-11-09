require('dotenv').config();

const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');
const { createPool } = require('./database');
const { passwordRounds, validEmail, validPassword } = require('./auth');

function promptHidden(prompt) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command in an interactive terminal.'));
  }

  return new Promise((resolve, reject) => {
    let value = '';
    let settled = false;
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();

    const cleanup = () => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
    };

    const onData = (buffer) => {
      for (const character of buffer.toString('utf8')) {
        if (character === '\u0003') {
          settled = true;
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Password entry cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          settled = true;
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };

    input.on('data', onData);
    input.once('close', () => {
      if (!settled) {
        cleanup();
        reject(new Error('Password input closed.'));
      }
    });
  });
}

async function main() {
  const [role, rawEmail, ...nameParts] = process.argv.slice(2);
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const fullName = nameParts.join(' ').trim();

  if (!['admin', 'assessor', 'qa'].includes(role) || !validEmail(email) || !fullName || fullName.length > 120) {
    throw new Error('Usage: npm run create-privileged-user -- <admin|assessor|qa> <email> <full name>');
  }

  const password = await promptHidden('Password (input hidden): ');
  if (!validPassword(password)) {
    throw new Error('Password must be between 12 and 72 UTF-8 bytes.');
  }

  const passwordHash = await bcrypt.hash(password, passwordRounds);
  const database = createPool();
  try {
    const { rows } = await database.query(
      `INSERT INTO users (id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name, role`,
      [randomUUID(), email, fullName, passwordHash, role],
    );
    console.log(`Created ${rows[0].role} account for ${rows[0].email}.`);
  } finally {
    await database.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const details = error.code ? { code: error.code } : { name: error.name };
    console.error('Privileged account provisioning failed:', details);
    if (error.message.startsWith('Usage:') || error.message.startsWith('Password must') || error.message === 'Run this command in an interactive terminal.') {
      console.error(error.message);
    }
    process.exitCode = 1;
  });
}

module.exports = { promptHidden };
