'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, Info, AlertTriangle, XCircle, CheckCircle } from 'lucide-react';
import {
  fetchUnreadCount,
  fetchNotifications,
  markNotificationReadApi,
  markAllNotificationsReadApi,
} from '../lib/api';
import { timeAgo } from '../lib/utils';
import type { NotificationInfo } from '../lib/api';

const SEVERITY_ICON: Record<string, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
  success: CheckCircle,
};

const SEVERITY_COLOR: Record<string, string> = {
  info: '#3b82f6',
  warning: '#f59e0b',
  error: 'var(--destructive)',
  success: '#22c55e',
};

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

  return (
    <div className="notif-bell-wrapper" ref={ref}>
      <button className="notif-bell-btn" onClick={handleOpen} title="Notifications">
        <Bell size={20} />
        {unread > 0 && (
          <span className="notif-bell-badge">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-header">
            <span>Notifications</span>
            {unread > 0 && (
              <button className="notif-mark-all" onClick={handleMarkAllRead}>
                Tout marquer lu
              </button>
            )}
          </div>
          <div className="notif-list">
            {loading ? (
              <div className="notif-empty">Chargement...</div>
            ) : notifications.length === 0 ? (
              <div className="notif-empty">Aucune notification</div>
            ) : (
              notifications.map((n) => {
                const SeverityIcon = SEVERITY_ICON[n.severity] ?? Info;
                const severityColor = SEVERITY_COLOR[n.severity] ?? '#3b82f6';
                return (
                  <button
                    key={n.id}
                    className={`notif-item ${!n.read ? 'unread' : ''} notif-item-severity-${n.severity}`}
                    onClick={() => handleClickNotification(n)}
                  >
                    <span className="notif-item-icon" style={{ color: severityColor }}>
                      <SeverityIcon size={16} />
                    </span>
                    <div className="notif-item-body">
                      <div className="notif-item-title">{n.title}</div>
                      <div className="notif-item-time">{timeAgo(n.created_at)}</div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="notif-dropdown-footer">
            <Link href="/notifications" onClick={() => setOpen(false)}>
              Voir toutes les notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
