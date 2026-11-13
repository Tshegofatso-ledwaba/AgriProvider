import { isRecord, requestApi } from '@/services/api';

export type NotificationCategory =
  | 'programmes'
  | 'attendance'
  | 'evidence'
  | 'assessment'
  | 'qa'
  | 'certification'
  | 'announcements'
  | 'general';

export type UserNotification = {
  id: string;
  event_type: string;
  category: NotificationCategory;
  title: string;
  message: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  action_path: string | null;
  priority: 'low' | 'normal' | 'high';
  created_at: string;
  read_at: string | null;
};

const categories: NotificationCategory[] = [
  'programmes', 'attendance', 'evidence', 'assessment', 'qa', 'certification', 'announcements', 'general',
];

function isNotification(value: unknown): value is UserNotification {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.event_type === 'string'
    && categories.includes(value.category as NotificationCategory)
    && typeof value.title === 'string'
    && typeof value.message === 'string'
    && (typeof value.related_entity_type === 'string' || value.related_entity_type === null)
    && (typeof value.related_entity_id === 'string' || value.related_entity_id === null)
    && (typeof value.action_path === 'string' || value.action_path === null)
    && (value.priority === 'low' || value.priority === 'normal' || value.priority === 'high')
    && typeof value.created_at === 'string'
    && (typeof value.read_at === 'string' || value.read_at === null);
}

export async function listNotifications(
  token: string,
  options: { unreadOnly?: boolean; limit?: number; offset?: number } = {},
): Promise<{ notifications: UserNotification[]; total: number; unreadCount: number }> {
  const query = new URLSearchParams({
    limit: String(options.limit ?? 50),
    offset: String(options.offset ?? 0),
  });
  if (options.unreadOnly !== undefined) query.set('unreadOnly', String(options.unreadOnly));
  const payload = await requestApi(`/api/notifications?${query}`, { token });
  if (!isRecord(payload) || !Array.isArray(payload.notifications)
    || !payload.notifications.every(isNotification)
    || typeof payload.total !== 'number' || typeof payload.unreadCount !== 'number') {
    throw new Error('The API returned an unexpected notification list.');
  }
  return {
    notifications: payload.notifications,
    total: payload.total,
    unreadCount: payload.unreadCount,
  };
}

export async function markNotificationRead(token: string, id: string): Promise<UserNotification> {
  const payload = await requestApi(`/api/notifications/${encodeURIComponent(id)}/read`, {
    method: 'PATCH',
    token,
  });
  if (!isRecord(payload) || !isNotification(payload.notification)) {
    throw new Error('The API returned an unexpected notification.');
  }
  return payload.notification;
}
