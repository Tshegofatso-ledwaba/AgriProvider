const { Router } = require('express');
const { authenticate } = require('./middleware/authenticate');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories = new Set([
  'programmes', 'attendance', 'evidence', 'assessment', 'qa', 'certification', 'announcements', 'general',
]);
const notificationColumns = `id, event_type, category, title, message, related_entity_type,
  related_entity_id, action_path, priority, created_at, read_at`;

function createNotificationsRouter({ database, jwtSecret }) {
  const router = Router();
  router.use(authenticate(database, jwtSecret));

  router.get('/', async (request, response, next) => {
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    const offset = request.query.offset === undefined ? 0 : Number(request.query.offset);
    const unreadOnly = request.query.unreadOnly === undefined
      ? null
      : request.query.unreadOnly === 'true' ? true : request.query.unreadOnly === 'false' ? false : undefined;
    const category = request.query.category;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100
      || !Number.isInteger(offset) || offset < 0) {
      return response.status(400).json({ error: 'Limit must be 1–100 and offset must be zero or greater.' });
    }
    if (unreadOnly === undefined) {
      return response.status(400).json({ error: 'unreadOnly must be true or false.' });
    }
    if (category !== undefined && !categories.has(category)) {
      return response.status(400).json({ error: 'Notification category is invalid.' });
    }

    try {
      const [{ rows: countRows }, { rows }] = await Promise.all([
        database.query(
          `SELECT COUNT(*) FILTER (
               WHERE ($2::boolean IS NULL OR ($2 AND read_at IS NULL) OR (NOT $2 AND read_at IS NOT NULL))
                 AND ($3::text IS NULL OR category = $3)
             )::integer AS total,
             COUNT(*) FILTER (WHERE read_at IS NULL)::integer AS unread_count
           FROM notifications
           WHERE recipient_user_id = $1`,
          [request.auth.userId, unreadOnly, category ?? null],
        ),
        database.query(
          `SELECT ${notificationColumns}
           FROM notifications
           WHERE recipient_user_id = $1
             AND ($2::boolean IS NULL OR ($2 AND read_at IS NULL) OR (NOT $2 AND read_at IS NOT NULL))
             AND ($3::text IS NULL OR category = $3)
           ORDER BY created_at DESC, id DESC
           LIMIT $4 OFFSET $5`,
          [request.auth.userId, unreadOnly, category ?? null, limit, offset],
        ),
      ]);
      return response.json({
        notifications: rows,
        total: countRows[0]?.total ?? 0,
        unreadCount: countRows[0]?.unread_count ?? 0,
        limit,
        offset,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id/read', async (request, response, next) => {
    if (!uuidPattern.test(request.params.id)) {
      return response.status(400).json({ error: 'Notification ID must be a UUID.' });
    }
    try {
      const { rows } = await database.query(
        `UPDATE notifications
         SET read_at = COALESCE(read_at, NOW())
         WHERE id = $1 AND recipient_user_id = $2
         RETURNING ${notificationColumns}`,
        [request.params.id, request.auth.userId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Notification not found.' });
      return response.json({ notification: rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createNotificationsRouter };
