'use client';

import { useState, useEffect } from 'react';
import { fetchMemorySettings, updateMemorySettingsApi } from '../../lib/api';
import type { MemorySettingsInfo } from '../../lib/api';

export default function LlmSettingsPage() {
  const [settings, setSettings] = useState<MemorySettingsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMemorySettings()
      .then(setSettings)
      .catch(() => setError('Erreur de chargement'))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      const updated = await updateMemorySettingsApi({
        prefer_openrouter: !settings.prefer_openrouter,
      });
      setSettings(updated);
    } catch {
      setError('Erreur de sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="notif-settings-container">
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0 0 8px' }}>LLM Provider</h1>
      <p className="text-muted" style={{ margin: '0 0 24px', fontSize: '0.8125rem' }}>
        Configure le routage des appels LLM. Par defaut, les modeles Claude passent directement par Anthropic.
      </p>

      {error && <p className="text-muted" style={{ color: 'var(--destructive)', marginBottom: 16 }}>{error}</p>}

      {loading ? (
        <p className="text-muted">Chargement...</p>
      ) : settings ? (
        <div className="notif-settings-grid">
          <div className="card notif-settings-card">
            <h3 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: 600 }}>OpenRouter</h3>
            <p className="text-muted" style={{ margin: '0 0 16px', fontSize: '0.8125rem' }}>
              Quand active, tous les appels LLM (y compris Claude) passent par OpenRouter pour une facturation unifiee. Whisper reste en direct.
            </p>
            <div className="memory-settings-section">
              <div className="memory-settings-field">
                <label>Router via OpenRouter</label>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.prefer_openrouter}
                    onChange={handleToggle}
                    disabled={saving}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
                Status : <span style={{ color: settings.prefer_openrouter ? 'var(--success)' : 'var(--text-muted)' }}>
                  {settings.prefer_openrouter ? 'Actif — tout passe par OpenRouter' : 'Inactif — routage standard (Anthropic direct pour Claude)'}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-muted">Parametres indisponibles</p>
      )}
    </div>
  );
}
