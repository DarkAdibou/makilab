'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  fetchFacts, addFactApi, deleteFactApi,
  searchMemory, fetchMemoryStats, fetchMemoryRetrievals,
} from '../lib/api';
import type {
  FactInfo, MemorySearchResult,
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
  const [searchMode, setSearchMode] = useState<'semantic' | 'text'>('text');
  const [searchResults, setSearchResults] = useState<MemorySearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchDone, setSearchDone] = useState(false);

  // ── Retrievals ──
  const [retrievals, setRetrievals] = useState<MemoryRetrievalInfo[]>([]);

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

  useEffect(() => {
    loadFacts();
    fetchMemoryRetrievals(20).then(setRetrievals).catch(() => {});
    fetchMemoryStats().then(setStats).catch(() => {}).finally(() => setStatsLoading(false));
  }, []);

  // ── Dynamic search with debounce ──
  const doSearch = useCallback((query: string, mode: 'semantic' | 'text') => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearchDone(false);
      return;
    }
    setSearchLoading(true);
    setSearchDone(false);
    searchMemory(query.trim(), mode, 20)
      .then((r) => { setSearchResults(r); setSearchDone(true); })
      .catch(() => { setSearchResults([]); setSearchDone(true); })
      .finally(() => setSearchLoading(false));
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchDone(false);
      return;
    }
    const timer = setTimeout(() => doSearch(searchQuery, searchMode), 400);
    return () => clearTimeout(timer);
  }, [searchQuery, searchMode, doSearch]);

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

  return (
    <div className="memory-container">
      <div className="memory-header">
        <h1>Memoire</h1>
      </div>

      {/* ── Search — sticky top ── */}
      <div className="memory-search-sticky">
        <div className="memory-search-bar">
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
              className={`btn ${searchMode === 'text' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '6px 12px', fontSize: '0.75rem' }}
              onClick={() => setSearchMode('text')}
            >
              Texte
            </button>
            <button
              type="button"
              className={`btn ${searchMode === 'semantic' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '6px 12px', fontSize: '0.75rem' }}
              onClick={() => setSearchMode('semantic')}
            >
              Semantique
            </button>
          </div>
          {searchLoading && <span className="chat-tool-spinner" />}
        </div>

        {searchDone && searchResults.length > 0 && (
          <div className="memory-search-results">
            {searchResults.map((r, i) => (
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
            ))}
          </div>
        )}
        {searchDone && searchResults.length === 0 && searchQuery.trim() && (
          <p className="text-muted" style={{ textAlign: 'center', padding: 8, margin: 0, fontSize: '0.8125rem' }}>Aucun resultat</p>
        )}
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

      {/* ── Retrievals — most recent first ── */}
      {retrievals.length > 0 && (
        <div className="card command-section">
          <h2>Retrievals recents</h2>
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
    </div>
  );
}
