'use client';

import { useState, useEffect } from 'react';
import { fetchNotificationSettings, updateNotificationSettingsApi } from '../../lib/api';
import type { NotificationSettingInfo } from '../../lib/api';

const NOTIFICATION_TYPES = ['cost_alert', 'task_failure', 'system', 'agent_error', 'summary'];

export default function NotificationSettingsPage() {
  const [settings, setSettings] = useState<NotificationSettingInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetchNotificationSettings()
      .then(setSettings)
      .catch(() => setSettings([]))
      .finally(() => setLoading(false));
  }, []);

  function getTypesArray(s: NotificationSettingInfo): string[] {
    if (!s.types_filter) return [];
    try {
      return JSON.parse(s.types_filter) as string[];
    } catch {
      return s.types_filter.split(',').map((t) => t.trim()).filter(Boolean);
    }
  }

  function handleToggleEnabled(channel: string) {
    setSettings((prev) =>
      prev.map((s) =>
        s.channel === channel ? { ...s, enabled: s.enabled ? 0 : 1 } : s,
      ),
    );
  }

  function handleToggleType(channel: string, type: string) {
    setSettings((prev) =>
      prev.map((s) => {
        if (s.channel !== channel) return s;
        const types = getTypesArray(s);
        const updated = types.includes(type) ? types.filter((t) => t !== type) : [...types, type];
        return { ...s, types_filter: JSON.stringify(updated) };
      }),
    );
  }

  function handleQuietHours(channel: string, field: 'quiet_hours_start' | 'quiet_hours_end', value: string) {
    setSettings((prev) =>
      prev.map((s) =>
        s.channel === channel ? { ...s, [field]: value || null } : s,
      ),
    );
  }

  async function handleSave(channel: string) {
    const s = settings.find((x) => x.channel === channel);
    if (!s) return;
    setSaving(channel);
    try {
      await updateNotificationSettingsApi(channel, {
        enabled: s.enabled,
        types_filter: s.types_filter,
        quiet_hours_start: s.quiet_hours_start,
        quiet_hours_end: s.quiet_hours_end,
      });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="notif-settings-container">
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0 0 24px' }}>Notifications</h1>

      {loading ? (
        <p className="text-muted">Chargement...</p>
      ) : settings.length === 0 ? (
        <p className="text-muted">Aucun canal configure</p>
      ) : (
        <div className="notif-settings-grid">
          {settings.map((s) => {
            const types = getTypesArray(s);
            return (
              <div key={s.channel} className="card notif-settings-card">
                <div className="notif-settings-card-header">
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, textTransform: 'capitalize' }}>
                    {s.channel}
                  </h3>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={!!s.enabled}
                      onChange={() => handleToggleEnabled(s.channel)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>

                <div className="notif-settings-section">
                  <span className="detail-label">Types de notification</span>
                  <div className="notif-settings-types">
                    {NOTIFICATION_TYPES.map((type) => (
                      <label key={type} className="notif-settings-type-label">
                        <input
                          type="checkbox"
                          checked={types.includes(type)}
                          onChange={() => handleToggleType(s.channel, type)}
                        />
                        <span>{type}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="notif-settings-section">
                  <span className="detail-label">Heures de silence</span>
                  <div className="notif-settings-quiet">
                    <label className="notif-settings-quiet-label">
                      <span className="text-muted" style={{ fontSize: '0.8125rem' }}>De</span>
                      <input
                        type="time"
                        value={s.quiet_hours_start ?? ''}
                        onChange={(e) => handleQuietHours(s.channel, 'quiet_hours_start', e.target.value)}
                        className="notif-settings-time-input"
                      />
                    </label>
                    <label className="notif-settings-quiet-label">
                      <span className="text-muted" style={{ fontSize: '0.8125rem' }}>A</span>
                      <input
                        type="time"
                        value={s.quiet_hours_end ?? ''}
                        onChange={(e) => handleQuietHours(s.channel, 'quiet_hours_end', e.target.value)}
                        className="notif-settings-time-input"
                      />
                    </label>
                  </div>
                </div>

                <button
                  className="btn btn-primary"
                  style={{ marginTop: 12, padding: '8px 16px', fontSize: '0.8125rem', alignSelf: 'flex-start' }}
                  onClick={() => handleSave(s.channel)}
                  disabled={saving === s.channel}
                >
                  {saving === s.channel ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
