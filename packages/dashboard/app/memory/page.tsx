'use client';

import { useState, useEffect } from 'react';
import {
  fetchFacts, addFactApi, deleteFactApi,
  fetchMemorySettings, updateMemorySettingsApi,
  searchMemory, fetchMemoryStats, fetchMemoryRetrievals,
} from '../lib/api';
import type {
  FactInfo, MemorySettingsInfo, MemorySearchResult,
  MemoryStats, MemoryRetrievalInfo,
} from '../lib/api';

export default function MemoryPage() {
  // ── Facts ──
  const [facts, setFacts] = useState<FactInfo[]>([]);
  const [factsLoading, setFactsLoading] = useState(true);
  const [factsError, setFactsError] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [addingFact, setAddingFact] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  // ── Search ──
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'semantic' | 'text'>('semantic');
  const [searchResults, setSearchResults] = useState<MemorySearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchDone, setSearchDone] = useState(false);

  // ── Settings ──
  const [settings, setSettings] = useState<MemorySettingsInfo | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [retrievals, setRetrievals] = useState<MemoryRetrievalInfo[]>([]);
  const [newNote, setNewNote] = useState('');

  // ── Stats ──
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // ── Load data ──
  const loadFacts = () => {
    setFactsLoading(true);
    setFactsError('');
    fetchFacts()
      .then(setFacts)
      .catch(() => setFactsError('Erreur de chargement des faits'))
      .finally(() => setFactsLoading(false));
  };

  const loadSettings = () => {
    setSettingsLoading(true);
    setSettingsError('');
    Promise.all([
      fetchMemorySettings(),
      fetchMemoryRetrievals(10),
    ])
      .then(([s, r]) => {
        setSettings(s);
        setRetrievals(r);
      })
      .catch(() => setSettingsError('Erreur de chargement des parametres'))
      .finally(() => setSettingsLoading(false));
  };

  const loadStats = () => {
    setStatsLoading(true);
    fetchMemoryStats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  };

  useEffect(() => {
    loadFacts();
    loadSettings();
    loadStats();
  }, []);

  // ── Fact handlers ──
  const handleDeleteFact = (key: string) => {
    deleteFactApi(key).then(loadFacts).catch(() => setFactsError('Erreur de suppression'));
  };

  const handleStartEdit = (fact: FactInfo) => {
    setEditingKey(fact.key);
    setEditKey(fact.key);
    setEditValue(fact.value);
  };

  const handleSaveEdit = () => {
    if (!editKey.trim()) return;
    // Delete old then add new
    const oldKey = editingKey!;
    const p = oldKey !== editKey.trim()
      ? deleteFactApi(oldKey).then(() => addFactApi(editKey.trim(), editValue.trim()))
      : addFactApi(editKey.trim(), editValue.trim());
    p.then(() => { setEditingKey(null); loadFacts(); })
      .catch(() => setFactsError('Erreur de mise a jour'));
  };

  const handleAddFact = () => {
    if (!newKey.trim() || !newValue.trim()) return;
    addFactApi(newKey.trim(), newValue.trim())
      .then(() => { setAddingFact(false); setNewKey(''); setNewValue(''); loadFacts(); })
      .catch(() => setFactsError('Erreur d\'ajout'));
  };

  // ── Search handler ──
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchDone(false);
    searchMemory(searchQuery.trim(), searchMode, 20)
      .then((r) => { setSearchResults(r); setSearchDone(true); })
      .catch(() => { setSearchResults([]); setSearchDone(true); })
      .finally(() => setSearchLoading(false));
  };

  // ── Settings handlers ──
  const updateSetting = <K extends keyof MemorySettingsInfo>(key: K, value: MemorySettingsInfo[K]) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    setSettingsDirty(true);
  };

  const handleSaveSettings = () => {
    if (!settings) return;
    setSettingsSaving(true);
    updateMemorySettingsApi(settings)
      .then((s) => { setSettings(s); setSettingsDirty(false); })
      .catch(() => setSettingsError('Erreur de sauvegarde'))
      .finally(() => setSettingsSaving(false));
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
    <div className="memory-container">
      <div className="memory-header">
        <h1>Memoire</h1>
      </div>

      {/* ── Stats ── */}
      <div className="stat-grid">
        {statsLoading ? (
          <p className="text-muted">Chargement...</p>
        ) : stats ? (
          <>
            <div className="card stat-card">
              <div className="stat-card-value">{stats.factsCount}</div>
              <div className="stat-card-label">Faits</div>
            </div>
            <div className="card stat-card">
              <div className="stat-card-value">{stats.messagesCount}</div>
              <div className="stat-card-label">Messages</div>
            </div>
            <div className="card stat-card">
              <div className="stat-card-value">{stats.vectorsCount}</div>
              <div className="stat-card-label">Vecteurs Qdrant</div>
            </div>
          </>
        ) : (
          <p className="text-muted">Stats indisponibles</p>
        )}
      </div>

      {/* ── Facts ── */}
      <div className="card command-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Faits connus</h2>
          {!addingFact && (
            <button className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: '0.8125rem' }} onClick={() => setAddingFact(true)}>
              + Ajouter
            </button>
          )}
        </div>

        {factsError && <p className="text-muted" style={{ color: 'var(--destructive)' }}>{factsError}</p>}

        {factsLoading ? (
          <p className="text-muted">Chargement...</p>
        ) : (
          <div className="memory-facts-list">
            {facts.map((fact) => (
              <div key={fact.key} className="memory-fact-row">
                {editingKey === fact.key ? (
                  <>
                    <input
                      className="textarea"
                      style={{ flex: 1, padding: '6px 10px', minHeight: 'auto' }}
                      value={editKey}
                      onChange={(e) => setEditKey(e.target.value)}
                    />
                    <input
                      className="textarea"
                      style={{ flex: 2, padding: '6px 10px', minHeight: 'auto' }}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                    <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: '0.75rem' }} onClick={handleSaveEdit}>OK</button>
                    <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: '0.75rem' }} onClick={() => setEditingKey(null)}>Annuler</button>
                  </>
                ) : (
                  <>
                    <span className="memory-fact-key">{fact.key}</span>
                    <span className="memory-fact-value">{fact.value}</span>
                    <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => handleStartEdit(fact)}>Modifier</button>
                    <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'var(--destructive)' }} onClick={() => handleDeleteFact(fact.key)}>Supprimer</button>
                  </>
                )}
              </div>
            ))}
            {facts.length === 0 && <p className="text-muted">Aucun fait enregistre</p>}
          </div>
        )}

        {addingFact && (
          <div className="memory-fact-row" style={{ marginTop: 12 }}>
            <input
              className="textarea"
              style={{ flex: 1, padding: '6px 10px', minHeight: 'auto' }}
              placeholder="Cle"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
            <input
              className="textarea"
              style={{ flex: 2, padding: '6px 10px', minHeight: 'auto' }}
              placeholder="Valeur"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
            />
            <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: '0.75rem' }} onClick={handleAddFact}>Ajouter</button>
            <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: '0.75rem' }} onClick={() => { setAddingFact(false); setNewKey(''); setNewValue(''); }}>Annuler</button>
          </div>
        )}
      </div>

      {/* ── Search ── */}
      <div className="card command-section">
        <h2>Recherche memoire</h2>
        <form onSubmit={handleSearch} className="memory-search-bar">
          <input
            className="textarea"
            style={{ flex: 1, padding: '8px 12px', minHeight: 'auto' }}
            placeholder="Rechercher dans la memoire..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="memory-search-toggle">
            <button
              type="button"
              className={`btn ${searchMode === 'semantic' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '6px 12px', fontSize: '0.75rem' }}
              onClick={() => setSearchMode('semantic')}
            >
              Semantique
            </button>
            <button
              type="button"
              className={`btn ${searchMode === 'text' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '6px 12px', fontSize: '0.75rem' }}
              onClick={() => setSearchMode('text')}
            >
              Texte
            </button>
          </div>
          <button type="submit" className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '0.8125rem' }} disabled={searchLoading}>
            {searchLoading ? '...' : 'Rechercher'}
          </button>
        </form>

        {searchDone && (
          <div className="memory-search-results">
            {searchResults.length === 0 ? (
              <p className="text-muted" style={{ textAlign: 'center', padding: 16 }}>Aucun resultat</p>
            ) : (
              searchResults.map((r, i) => (
                <div key={i} className="memory-search-result-card card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span className="badge badge-muted">{r.channel}</span>
                    <span className="badge badge-outline">{r.type}</span>
                    {r.score != null && (
                      <span className="text-muted" style={{ fontSize: '0.75rem', marginLeft: 'auto' }}>
                        score: {r.score.toFixed(3)}
                      </span>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}>{r.content}</p>
                  <span className="text-muted" style={{ fontSize: '0.6875rem', marginTop: 6, display: 'block' }}>
                    {new Date(r.created_at).toLocaleString('fr-FR')}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Settings ── */}
      <div className="card command-section">
        <h2>Auto-retrieval</h2>

        {settingsError && <p className="text-muted" style={{ color: 'var(--destructive)' }}>{settingsError}</p>}

        {settingsLoading ? (
          <p className="text-muted">Chargement...</p>
        ) : settings ? (
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

            <div className="memory-settings-field">
              <label>Contexte Obsidian</label>
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
              <label>Tag Obsidian</label>
              <input
                className="textarea"
                style={{ flex: 1, padding: '6px 10px', minHeight: 'auto', maxWidth: 240 }}
                value={settings.obsidian_context_tag}
                onChange={(e) => updateSetting('obsidian_context_tag', e.target.value)}
              />
            </div>

            <div className="memory-settings-field" style={{ alignItems: 'flex-start' }}>
              <label>Notes Obsidian</label>
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

            {settingsDirty && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  className="btn btn-primary"
                  style={{ padding: '8px 20px', fontSize: '0.8125rem' }}
                  onClick={handleSaveSettings}
                  disabled={settingsSaving}
                >
                  {settingsSaving ? 'Sauvegarde...' : 'Sauvegarder'}
                </button>
              </div>
            )}

            {/* Recent retrievals */}
            {retrievals.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 12px' }}>Retrievals recents</h3>
                <div className="memory-retrievals-table">
                  <table className="recurring-table">
                    <thead>
                      <tr>
                        <th>Canal</th>
                        <th>Message</th>
                        <th>Memories</th>
                        <th>Obsidian</th>
                        <th>Tokens</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {retrievals.map((r) => (
                        <tr key={r.id} className="recurring-row">
                          <td><span className="badge badge-muted">{r.channel}</span></td>
                          <td style={{ fontSize: '0.8125rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.user_message_preview}</td>
                          <td style={{ textAlign: 'center' }}>{r.memories_injected}</td>
                          <td style={{ textAlign: 'center' }}>{r.obsidian_notes_injected}</td>
                          <td style={{ textAlign: 'center', fontSize: '0.75rem' }}>{r.total_tokens_added}</td>
                          <td className="text-muted" style={{ fontSize: '0.75rem' }}>
                            {new Date(r.created_at).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted">Parametres indisponibles</p>
        )}
      </div>
    </div>
  );
}
