'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Info, AlertTriangle, XCircle, CheckCircle, ArrowRight } from 'lucide-react';
import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationReadApi,
  markAllNotificationsReadApi,
} from '../lib/api';
import { timeAgo } from '../lib/utils';
import type { NotificationInfo } from '../lib/api';

const SEVERITY_ICON: Record<string, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
  critical: XCircle,
  success: CheckCircle,
};

const SEVERITY_COLOR: Record<string, string> = {
  info: '#3b82f6',
  warning: '#f59e0b',
  error: 'var(--destructive)',
  critical: 'var(--destructive)',
  success: '#22c55e',
};

const TYPE_LABELS: Record<string, string> = {
  cost_optimization: 'Coûts',
  task_failure: 'Échecs',
  catalog_update: 'Catalogue',
  cron_result: 'CRON',
  system_alert: 'Système',
};

const PAGE_SIZE = 50;

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationInfo[]>([]);
  const [unreadFilter, setUnreadFilter] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [notifs, count] = await Promise.all([
        fetchNotifications(unreadFilter, PAGE_SIZE * page),
        fetchUnreadCount(),
      ]);
      setNotifications(notifs);
      setUnreadCount(count);
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [unreadFilter, page]);

  useEffect(() => {
    setPage(1);
  }, [unreadFilter, typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleClick(n: NotificationInfo) {
    if (!n.read) {
      await markNotificationReadApi(n.id);
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: 1 } : x));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
    if (n.link) {
      router.push(n.link);
    }
  }

  async function handleMarkAllRead() {
    await markAllNotificationsReadApi();
    setNotifications(prev => prev.map(x => ({ ...x, read: 1 })));
    setUnreadCount(0);
  }

  const filtered = typeFilter
    ? notifications.filter(n => n.type === typeFilter)
    : notifications;

  const types = [...new Set(notifications.map(n => n.type))];

  return (
    <div className="notif-page-container">
      <div className="notif-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Notifications</h1>
          {unreadCount > 0 && (
            <span className="badge badge-primary">{unreadCount} non lues</span>
          )}
        </div>
        {unreadCount > 0 && (
          <button className="btn btn-ghost" style={{ fontSize: '0.8125rem' }} onClick={handleMarkAllRead}>
            Tout marquer lu
          </button>
        )}
      </div>

      <div className="notif-page-filters">
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`btn ${!unreadFilter ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: '0.8125rem', padding: '6px 14px' }}
            onClick={() => setUnreadFilter(false)}
          >
            Toutes
          </button>
          <button
            className={`btn ${unreadFilter ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: '0.8125rem', padding: '6px 14px' }}
            onClick={() => setUnreadFilter(true)}
          >
            Non lues
          </button>
        </div>
        {types.length > 0 && (
          <select
            className="textarea filter-select"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="">Tous les types</option>
            {types.map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <p className="text-muted">Chargement...</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted">Aucune notification.</p>
      ) : (
        <div className="notif-page-list">
          {filtered.map(n => {
            const SeverityIcon = SEVERITY_ICON[n.severity] ?? Info;
            const severityColor = SEVERITY_COLOR[n.severity] ?? '#3b82f6';
            return (
              <button
                key={n.id}
                className={`notif-page-item ${!n.read ? 'unread' : ''}`}
                style={{ borderLeftColor: severityColor }}
                onClick={() => handleClick(n)}
              >
                <span style={{ color: severityColor, flexShrink: 0, paddingTop: 2 }}>
                  <SeverityIcon size={16} />
                </span>
                <div className="notif-page-item-body">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: n.read ? 400 : 600, fontSize: '0.875rem' }}>{n.title}</span>
                    <span className="badge badge-muted" style={{ fontSize: '0.6875rem', padding: '1px 6px' }}>
                      {TYPE_LABELS[n.type] ?? n.type}
                    </span>
                  </div>
                  {n.body && (
                    <div className="notif-page-item-body-text">{n.body}</div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="text-muted" style={{ fontSize: '0.75rem' }}>{timeAgo(n.created_at)}</span>
                  </div>
                </div>
                {n.link && (
                  <span style={{ color: 'var(--muted-foreground)', flexShrink: 0 }}>
                    <ArrowRight size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {filtered.length >= PAGE_SIZE * page && (
        <button
          className="btn btn-ghost"
          style={{ alignSelf: 'center', fontSize: '0.8125rem' }}
          onClick={() => setPage(p => p + 1)}
        >
          Charger plus
        </button>
      )}
    </div>
  );
}
