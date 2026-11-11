const jwt = require('jsonwebtoken');

const allowedRoles = new Set(['provider', 'assessor', 'qa', 'admin', 'learner']);

function authenticate(database, jwtSecret) {
  return async (request, response, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(request.get('authorization') || '');
    const cookieToken = request.get('x-auth-mode') === 'cookie'
      ? String(request.get('cookie') || '')
        .split(';')
        .map((value) => value.trim())
        .find((value) => value.startsWith('agriprovider_session='))
        ?.slice('agriprovider_session='.length)
      : undefined;
    const token = match ? match[1] : cookieToken;
    if (!token) {
      return response.status(401).json({ error: 'Authentication required.' });
    }

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret, {
        audience: 'agriprovider-app',
        issuer: 'agriprovider-api',
      });

      if (
        typeof payload === 'string'
        || typeof payload.sub !== 'string'
        || !allowedRoles.has(payload.role)
      ) {
        return response.status(401).json({ error: 'Authentication required.' });
      }
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        return response.status(401).json({ error: 'Authentication required.' });
      }
      return next(error);
    }

    try {
      const { rows } = await database.query(
        `SELECT id, email, full_name, role
         FROM users
         WHERE id = $1 AND is_active = TRUE`,
        [payload.sub],
      );
      const user = rows[0];

      if (!user || !allowedRoles.has(user.role)) {
        return response.status(401).json({ error: 'Authentication required.' });
      }

      request.auth = { userId: user.id, role: user.role };
      request.user = {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireRole(...roles) {
  return (request, response, next) => {
    if (!request.auth) {
      return response.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(request.auth.role)) {
      return response.status(403).json({ error: 'Access denied.' });
    }
    return next();
  };
}

module.exports = { authenticate, requireRole };
