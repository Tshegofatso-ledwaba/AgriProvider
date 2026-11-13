const { createHash, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { isDatabaseConnectionError } = require('./database');
const { authenticate } = require('./middleware/authenticate');

const roles = new Set(['provider', 'assessor', 'qa', 'admin', 'learner']);
const passwordRounds = 12;
const sessionCookieName = 'agriprovider_session';
const sessionMaxAge = 60 * 60 * 1000;

function sessionCookieOptions(secure) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api',
    maxAge: sessionMaxAge,
  };
}

function publicUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
  };
}

function createToken(user, jwtSecret) {
  return jwt.sign({ role: user.role }, jwtSecret, {
    subject: user.id,
    audience: 'agriprovider-app',
    issuer: 'agriprovider-api',
    expiresIn: '1h',
  });
}

function validEmail(email) {
  return typeof email === 'string'
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPassword(password) {
  return typeof password === 'string'
    && password.length >= 12
    && Buffer.byteLength(password, 'utf8') <= 72;
}

function createAuthRouter({ database, jwtSecret, secureCookies }) {
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }

  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again later.' },
  });
  const registrationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many registration attempts. Try again later.' },
  });
  const learnerActivationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many learner setup attempts. Try again later.' },
  });
  const requireAuthentication = authenticate(database, jwtSecret);
  const dummyPasswordHash = bcrypt.hashSync(randomUUID(), passwordRounds);

  function sendAuthenticationResult(request, response, status, row, user) {
    const accessToken = createToken(row, jwtSecret);
    if (request.get('x-auth-mode') === 'cookie') {
      response.cookie(sessionCookieName, accessToken, sessionCookieOptions(secureCookies));
      return response.status(status).json({ user });
    }

    return response.status(status).json({ user, accessToken });
  }

  async function findLoginUser(email) {
    const query = `SELECT id, email, full_name, password_hash, role
      FROM users
      WHERE email = $1 AND is_active = TRUE`;
    try {
      return await database.query(query, [email]);
    } catch (error) {
      if (!isDatabaseConnectionError(error)) throw error;
      console.warn('Transient database connection error during sign-in; retrying once:', error.code || error.name);
      await new Promise((resolve) => setTimeout(resolve, 250));
      return database.query(query, [email]);
    }
  }

  router.post('/register', registrationLimiter, async (request, response, next) => {
    const body = request.body ?? {};
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body.password;

    if (!fullName || fullName.length > 120 || !validEmail(email) || !validPassword(password)) {
      return response.status(400).json({
        error: 'Provide a name, valid email, and password between 12 and 72 UTF-8 bytes.',
      });
    }

    try {
      const passwordHash = await bcrypt.hash(password, passwordRounds);
      const { rows } = await database.query(
        `INSERT INTO users (id, email, full_name, password_hash, role)
         VALUES ($1, $2, $3, $4, 'provider')
         RETURNING id, email, full_name, role`,
        [randomUUID(), email, fullName, passwordHash],
      );
      const user = publicUser(rows[0]);

      return sendAuthenticationResult(request, response, 201, rows[0], user);
    } catch (error) {
      if (error.code === '23505') {
        return response.status(409).json({ error: 'An account with this email already exists.' });
      }

      return next(error);
    }
  });

  router.post('/login', loginLimiter, async (request, response, next) => {
    const body = request.body ?? {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body.password;
    const accountType = body.accountType;

    if (!validEmail(email) || !validPassword(password)) {
      return response.status(400).json({ error: 'Provide a valid email and password.' });
    }
    if (accountType !== undefined && !roles.has(accountType)) {
      return response.status(400).json({ error: 'Choose a supported sign-in type.' });
    }

    try {
      const { rows } = await findLoginUser(email);
      const row = rows[0];
      const passwordMatches = await bcrypt.compare(
        password,
        row ? row.password_hash : dummyPasswordHash,
      );

      if (!row || !passwordMatches || !roles.has(row.role)
        || (accountType !== undefined && row.role !== accountType)) {
        return response.status(401).json({
          error: 'Email or password is incorrect.',
        });
      }

      return sendAuthenticationResult(request, response, 200, row, publicUser(row));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/learner-activation', learnerActivationLimiter, async (request, response, next) => {
    const body = request.body ?? {};
    if (typeof body.token !== 'string' || !/^[0-9a-f]{64}$/i.test(body.token)
      || !validPassword(body.password)) {
      return response.status(400).json({
        error: 'Provide a valid learner setup code and a password between 12 and 72 UTF-8 bytes.',
      });
    }

    const tokenHash = createHash('sha256').update(body.token).digest('hex');
    let client;
    let transactionOpen = false;
    try {
      client = await database.connect();
      await client.query('BEGIN');
      transactionOpen = true;
      const { rows: invitationRows } = await client.query(
        `SELECT i.id, i.learner_id, l.email, l.full_name, l.learner_user_id
         FROM learner_account_invitations i
         JOIN learners l ON l.id = i.learner_id
         WHERE i.token_hash = $1
           AND i.consumed_at IS NULL
           AND i.revoked_at IS NULL
           AND i.expires_at > NOW()
           AND l.archived_at IS NULL
         FOR UPDATE OF i, l`,
        [tokenHash],
      );
      const invitation = invitationRows[0];
      if (!invitation) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return response.status(400).json({ error: 'This learner setup code is invalid or expired.' });
      }
      if (invitation.learner_user_id) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return response.status(409).json({ error: 'This learner profile already has an account.' });
      }

      const { rows: existingUsers } = await client.query(
        `SELECT id
         FROM users
         WHERE lower(email) = lower($1)
         FOR UPDATE`,
        [invitation.email],
      );
      if (existingUsers[0]) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return response.status(409).json({ error: 'An account already uses this learner email. Contact the provider.' });
      }

      const passwordHash = await bcrypt.hash(body.password, passwordRounds);
      const { rows: userRows } = await client.query(
        `INSERT INTO users (id, email, full_name, password_hash, role)
         VALUES ($1, $2, $3, $4, 'learner')
         RETURNING id, email, full_name, role`,
        [randomUUID(), invitation.email.trim().toLowerCase(), invitation.full_name, passwordHash],
      );
      const user = userRows[0];
      const { rowCount: linkCount } = await client.query(
        `UPDATE learners
         SET learner_user_id = $1, updated_at = NOW()
         WHERE id = $2 AND learner_user_id IS NULL AND archived_at IS NULL`,
        [user.id, invitation.learner_id],
      );
      if (linkCount !== 1) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return response.status(409).json({ error: 'This learner profile can no longer be activated.' });
      }
      const { rowCount: consumeCount } = await client.query(
        `UPDATE learner_account_invitations
         SET consumed_at = NOW()
         WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [invitation.id],
      );
      if (consumeCount !== 1) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return response.status(409).json({ error: 'This learner setup code has already been used.' });
      }

      await client.query('COMMIT');
      transactionOpen = false;
      return response.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK');
      if (error.code === '23505') {
        return response.status(409).json({ error: 'An account already uses this learner email. Contact the provider.' });
      }
      return next(error);
    } finally {
      client?.release();
    }
  });

  router.get('/me', requireAuthentication, async (request, response, next) => {
    return response.json({ user: request.user });
  });

  router.post('/logout', (request, response) => {
    response.clearCookie(sessionCookieName, {
      ...sessionCookieOptions(secureCookies),
      maxAge: undefined,
    });
    return response.status(204).end();
  });

  return router;
}

module.exports = {
  createAuthRouter,
  passwordRounds,
  roles,
  validEmail,
  validPassword,
};
