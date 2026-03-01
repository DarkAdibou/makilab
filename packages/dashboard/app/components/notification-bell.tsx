'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  fetchUnreadCount,
  fetchNotifications,
  markNotificationReadApi,
  markAllNotificationsReadApi,
} from '../lib/api';
import type { NotificationInfo } from '../lib/api';

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const pollCount = useCallback(() => {
    fetchUnreadCount().then(setUnread).catch(() => {});
  }, []);

  useEffect(() => {
    pollCount();
    const interval = setInterval(pollCount, 30_000);
    return () => clearInterval(interval);
  }, [pollCount]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    try {
      const notifs = await fetchNotifications(false, 10);
      setNotifications(notifs);
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleClickNotification(n: NotificationInfo) {
    if (!n.read) {
      await markNotificationReadApi(n.id);
      setUnread((prev) => Math.max(0, prev - 1));
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read: 1 } : x)),
      );
    }
    if (n.link) {
      router.push(n.link);
      setOpen(false);
    }
  }

  async function handleMarkAllRead() {
    await markAllNotificationsReadApi();
    setUnread(0);
    setNotifications((prev) => prev.map((x) => ({ ...x, read: 1 })));
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'maintenant';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}j`;
  }

  const severityIcon: Record<string, string> = {
    info: 'i',
    warning: '!',
    error: 'x',
    success: 'v',
  };

  return (
    <div className="notif-bell-wrapper" ref={ref}>
      <button className="notif-bell-btn" onClick={handleOpen} title="Notifications">
        <span className="notif-bell-icon">&#128276;</span>
        {unread > 0 && <span className="notif-bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-header">
            <span className="notif-dropdown-title">Notifications</span>
            {unread > 0 && (
              <button className="btn btn-ghost notif-mark-all" onClick={handleMarkAllRead}>
                Tout marquer lu
              </button>
            )}
          </div>
          <div className="notif-dropdown-body">
            {loading ? (
              <p className="text-muted" style={{ padding: 16, textAlign: 'center' }}>Chargement...</p>
            ) : notifications.length === 0 ? (
              <p className="text-muted" style={{ padding: 16, textAlign: 'center' }}>Aucune notification</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  className={`notif-item ${n.read ? '' : 'notif-item-unread'}`}
                  onClick={() => handleClickNotification(n)}
                >
                  <span className={`notif-severity notif-severity-${n.severity}`}>
                    {severityIcon[n.severity] ?? 'i'}
                  </span>
                  <div className="notif-item-content">
                    <span className="notif-item-title">{n.title}</span>
                    <span className="notif-item-body">{n.body}</span>
                  </div>
                  <span className="notif-item-time">{timeAgo(n.created_at)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
