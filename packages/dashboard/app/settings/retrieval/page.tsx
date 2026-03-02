'use client';

import { useState, useEffect } from 'react';
import {
  fetchMemorySettings, updateMemorySettingsApi,
} from '../../lib/api';
import type { MemorySettingsInfo } from '../../lib/api';

export default function RetrievalSettingsPage() {
  const [settings, setSettings] = useState<MemorySettingsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newNote, setNewNote] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchMemorySettings()
      .then(setSettings)
      .catch(() => setError('Erreur de chargement'))
      .finally(() => setLoading(false));
  }, []);

  const updateSetting = <K extends keyof MemorySettingsInfo>(key: K, value: MemorySettingsInfo[K]) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    setDirty(true);
  };

  const handleSave = () => {
    if (!settings) return;
    setSaving(true);
    updateMemorySettingsApi(settings)
      .then((s) => { setSettings(s); setDirty(false); })
      .catch(() => setError('Erreur de sauvegarde'))
      .finally(() => setSaving(false));
  };

  const handleAddNote = () => {
    if (!settings || !newNote.trim()) return;
    const notes = [...settings.obsidian_context_notes, newNote.trim()];
    updateSetting('obsidian_context_notes', notes);
    setNewNote('');
  };

  const handleRemoveNote = (idx: number) => {
    if (!settings) return;
    const notes = settings.obsidian_context_notes.filter((_, i) => i !== idx);
    updateSetting('obsidian_context_notes', notes);
  };

  return (
    <div className="notif-settings-container">
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0 0 24px' }}>Auto-retrieval</h1>

      {error && <p className="text-muted" style={{ color: 'var(--destructive)' }}>{error}</p>}

      {loading ? (
        <p className="text-muted">Chargement...</p>
      ) : settings ? (
        <div className="notif-settings-grid">
          <div className="card notif-settings-card">
            <h3 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: 600 }}>Memoire semantique</h3>
            <div className="memory-settings-section">
              <div className="memory-settings-field">
                <label>Auto-retrieve</label>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.auto_retrieve_enabled}
                    onChange={(e) => updateSetting('auto_retrieve_enabled', e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div className="memory-settings-field">
                <label>Max resultats</label>
                <input
                  type="number"
                  className="textarea"
                  style={{ width: 80, padding: '4px 8px', minHeight: 'auto', textAlign: 'center' }}
                  min={1}
                  max={10}
                  value={settings.auto_retrieve_max_results}
                  onChange={(e) => updateSetting('auto_retrieve_max_results', Number(e.target.value))}
                />
              </div>

              <div className="memory-settings-field">
                <label>Score minimum</label>
                <input
                  type="number"
                  className="textarea"
                  style={{ width: 80, padding: '4px 8px', minHeight: 'auto', textAlign: 'center' }}
                  min={0.1}
                  max={0.9}
                  step={0.1}
                  value={settings.auto_retrieve_min_score}
                  onChange={(e) => updateSetting('auto_retrieve_min_score', Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          <div className="card notif-settings-card">
            <h3 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: 600 }}>Contexte Obsidian</h3>
            <div className="memory-settings-section">
              <div className="memory-settings-field">
                <label>Active</label>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.obsidian_context_enabled}
                    onChange={(e) => updateSetting('obsidian_context_enabled', e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div className="memory-settings-field">
                <label>Tag</label>
                <input
                  className="textarea"
                  style={{ flex: 1, padding: '6px 10px', minHeight: 'auto', maxWidth: 240 }}
                  value={settings.obsidian_context_tag}
                  onChange={(e) => updateSetting('obsidian_context_tag', e.target.value)}
                />
              </div>

              <div className="memory-settings-field" style={{ alignItems: 'flex-start' }}>
                <label>Notes</label>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {settings.obsidian_context_notes.map((note, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-mono)' }}>{note}</span>
                      <button className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: '0.6875rem', color: 'var(--destructive)' }} onClick={() => handleRemoveNote(i)}>x</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="textarea"
                      style={{ flex: 1, padding: '4px 8px', minHeight: 'auto', maxWidth: 240 }}
                      placeholder="Chemin de la note"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddNote(); } }}
                    />
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={handleAddNote}>+</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {dirty && (
            <button
              className="btn btn-primary"
              style={{ padding: '8px 20px', fontSize: '0.8125rem', alignSelf: 'flex-start' }}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Sauvegarde...' : 'Sauvegarder'}
            </button>
          )}
        </div>
      ) : (
        <p className="text-muted">Parametres indisponibles</p>
      )}
    </div>
  );
}
