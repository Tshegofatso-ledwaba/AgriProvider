const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');

const jwtSecret = 'notifications-test-secret-with-more-than-thirty-two-characters';
const qaUserId = randomUUID();
const providerUserId = randomUUID();
const learnerUserId = randomUUID();
const qaNotificationId = randomUUID();
const qaReadNotificationId = randomUUID();
const providerNotificationId = randomUUID();
const learnerNotificationId = randomUUID();
const users = [
  { id: qaUserId, email: 'qa@example.test', full_name: 'QA Officer', role: 'qa', is_active: true },
  { id: providerUserId, email: 'provider@example.test', full_name: 'Provider', role: 'provider', is_active: true },
  { id: learnerUserId, email: 'learner@example.test', full_name: 'Learner', role: 'learner', is_active: true },
];
const notifications = [
  { id: qaNotificationId, recipient_user_id: qaUserId, event_type: 'qa.assessment_ready', category: 'qa', title: 'Assessment ready', message: 'A review is ready.', related_entity_type: 'evidence_review', related_entity_id: randomUUID(), action_path: '/qa', priority: 'high', created_at: new Date().toISOString(), read_at: null },
  { id: qaReadNotificationId, recipient_user_id: qaUserId, event_type: 'qa.assignment_changed', category: 'qa', title: 'Assignment updated', message: 'QA scope changed.', related_entity_type: 'qa_assignment', related_entity_id: randomUUID(), action_path: '/qa', priority: 'normal', created_at: new Date(Date.now() - 1000).toISOString(), read_at: new Date().toISOString() },
  { id: providerNotificationId, recipient_user_id: providerUserId, event_type: 'qa.review_completed', category: 'qa', title: 'QA review completed', message: 'QA status updated.', related_entity_type: 'evidence_review', related_entity_id: randomUUID(), action_path: '/enrolments', priority: 'normal', created_at: new Date().toISOString(), read_at: null },
  { id: learnerNotificationId, recipient_user_id: learnerUserId, event_type: 'qa.review_completed', category: 'qa', title: 'QA status updated', message: 'QA status updated.', related_entity_type: 'evidence_review', related_entity_id: randomUUID(), action_path: '/learner', priority: 'normal', created_at: new Date().toISOString(), read_at: null },
];
const database = {
  async query(sql, values = []) {
    if (sql.includes('FROM users') && sql.includes('WHERE id = $1')) {
      const user = users.find((item) => item.id === values[0] && item.is_active);
      return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
    }
    if (sql.includes('FROM notifications') && sql.includes('COUNT(*)')) {
      const own = notifications.filter((item) => item.recipient_user_id === values[0]);
      return {
        rows: [{
          total: own.filter((item) => (values[1] === null
            || (values[1] ? item.read_at === null : item.read_at !== null))
            && (!values[2] || item.category === values[2])).length,
          unread_count: own.filter((item) => item.read_at === null).length,
        }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM notifications') && sql.includes('ORDER BY created_at DESC')) {
      const [recipientId, unreadOnly, category, limit, offset] = values;
      const own = notifications.filter((item) => item.recipient_user_id === recipientId
        && (unreadOnly === null || (unreadOnly ? item.read_at === null : item.read_at !== null))
        && (!category || item.category === category))
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .slice(offset, offset + limit)
        .map(({ id, event_type, category: itemCategory, title, message, related_entity_type, related_entity_id, action_path, priority, created_at, read_at }) => ({
          id, event_type, category: itemCategory, title, message, related_entity_type, related_entity_id, action_path, priority, created_at, read_at,
        }));
      return { rows: own, rowCount: own.length };
    }
    if (sql.includes('UPDATE notifications')) {
      const notification = notifications.find((item) => item.id === values[0]
        && item.recipient_user_id === values[1]);
      if (!notification) return { rows: [], rowCount: 0 };
      notification.read_at ??= new Date().toISOString();
      return { rows: [{ ...notification }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL in notifications test: ${sql}`);
  },
};

function tokenFor(userId, role) {
  return jwt.sign({ role }, jwtSecret, {
    subject: userId,
    audience: 'agriprovider-app',
    issuer: 'agriprovider-api',
    expiresIn: '1h',
  });
}

const app = createApp(database, { jwtSecret, webOrigin: 'http://localhost:8081' });
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function getNotifications(userId, role, query = '', token = tokenFor(userId, role)) {
  return fetch(`${baseUrl}/api/notifications${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

test('notification inbox is recipient-scoped across QA, provider, and learner roles', async () => {
  for (const [userId, role, expectedId] of [
    [qaUserId, 'qa', qaNotificationId],
    [providerUserId, 'provider', providerNotificationId],
    [learnerUserId, 'learner', learnerNotificationId],
  ]) {
    const response = await getNotifications(userId, role);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.total, userId === qaUserId ? 2 : 1);
    assert.equal(body.unreadCount, 1);
    assert.equal(body.notifications[0].id, expectedId);
  }
});

test('notification inbox validates filters and pagination and requires authentication', async () => {
  assert.equal((await getNotifications(qaUserId, 'qa', '?unreadOnly=no')).status, 400);
  assert.equal((await getNotifications(qaUserId, 'qa', '?category=unknown')).status, 400);
  assert.equal((await getNotifications(qaUserId, 'qa', '?limit=101')).status, 400);
  assert.equal((await getNotifications(qaUserId, 'qa', '', null)).status, 401);
  const unread = await getNotifications(qaUserId, 'qa', '?unreadOnly=true&category=qa');
  const unreadBody = await unread.json();
  assert.equal(unreadBody.notifications.length, 1);
  assert.equal(unreadBody.total, 1);
  assert.equal(unreadBody.unreadCount, 1);
  const read = await getNotifications(qaUserId, 'qa', '?unreadOnly=false');
  assert.equal((await read.json()).total, 1);
});

test('users can mark only their own notifications as read', async () => {
  const denied = await fetch(`${baseUrl}/api/notifications/${providerNotificationId}/read`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${tokenFor(qaUserId, 'qa')}` },
  });
  assert.equal(denied.status, 404);

  const marked = await fetch(`${baseUrl}/api/notifications/${qaNotificationId}/read`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${tokenFor(qaUserId, 'qa')}` },
  });
  assert.equal(marked.status, 200);
  assert.equal(typeof (await marked.json()).notification.read_at, 'string');

  const repeat = await fetch(`${baseUrl}/api/notifications/${qaNotificationId}/read`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${tokenFor(qaUserId, 'qa')}` },
  });
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).notification.read_at, notifications[0].read_at);

  const invalid = await fetch(`${baseUrl}/api/notifications/not-a-uuid/read`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${tokenFor(qaUserId, 'qa')}` },
  });
  assert.equal(invalid.status, 400);
});
