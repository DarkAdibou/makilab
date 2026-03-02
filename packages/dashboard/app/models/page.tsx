'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  fetchSuggestions,
  fetchRoutes,
  fetchCatalog,
  fetchCatalogMeta,
  updateRouteApi,
  refreshCatalogApi,
} from '../lib/api';
import type {
  OptimizationSuggestion,
  RouteWithSuggestions,
  CatalogModel,
} from '../lib/api';

function formatPrice(perM: number): string {
  if (perM === 0) return 'gratuit';
  if (perM < 0.01) return `$${perM.toFixed(4)}/M`;
  return `$${perM.toFixed(2)}/M`;
}

function inferUseCases(m: CatalogModel): string[] {
  const id = m.id.toLowerCase();
  const name = m.name.toLowerCase();
  const desc = (m.description ?? '').toLowerCase();
  const combined = `${id} ${name} ${desc}`;
  const tags: string[] = [];
  if (combined.includes('code') || combined.includes('coder') || combined.includes('codestral')) tags.push('Code');
  if (combined.includes('reasoning') || combined.includes('think') || m.supports_reasoning) tags.push('Raisonnement');
  if (combined.includes('search') || combined.includes('perplexity') || combined.includes('sonar')) tags.push('Recherche');
  if (combined.includes('vision') || combined.includes('image') || combined.includes('multimodal')) tags.push('Vision');
  if (combined.includes('fast') || combined.includes('flash') || combined.includes('haiku') || combined.includes('mini')) tags.push('Rapide');
  if (m.price_input_per_m <= 1 && m.price_output_per_m <= 5) tags.push('Économique');
  if (tags.length === 0) tags.push('Chat');
  return tags;
}

type SortKey = 'name' | 'provider_slug' | 'price_input_per_m' | 'price_output_per_m' | 'context_length';

export default function ModelsPage() {
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);
  const [routes, setRoutes] = useState<RouteWithSuggestions[]>([]);
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [meta, setMeta] = useState<{ count: number; lastUpdate: string | null }>({ count: 0, lastUpdate: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [toolsFilter, setToolsFilter] = useState<'' | 'yes' | 'no'>('');
  const [contextFilter, setContextFilter] = useState<'' | 'small' | 'medium' | 'large'>('');
  const [priceFilter, setPriceFilter] = useState<'' | 'cheap' | 'mid' | 'expensive'>('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchSuggestions().catch(() => []),
      fetchRoutes().catch(() => []),
      fetchCatalog().catch(() => []),
      fetchCatalogMeta().catch(() => ({ count: 0, lastUpdate: null })),
    ]).then(([s, r, c, m]) => {
      setSuggestions(s);
      setRoutes(r);
      setCatalog(c);
      setMeta(m);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const providers = useMemo(() => {
    const set = new Set(catalog.map((m) => m.provider_slug));
    return Array.from(set).sort();
  }, [catalog]);

  const filteredCatalog = useMemo(() => {
    let items = catalog;
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
    }
    if (providerFilter) {
      items = items.filter((m) => m.provider_slug === providerFilter);
    }
    if (toolsFilter === 'yes') items = items.filter((m) => m.supports_tools === 1);
    if (toolsFilter === 'no') items = items.filter((m) => m.supports_tools === 0);
    if (contextFilter === 'small') items = items.filter((m) => m.context_length > 0 && m.context_length < 32000);
    if (contextFilter === 'medium') items = items.filter((m) => m.context_length >= 32000 && m.context_length <= 128000);
    if (contextFilter === 'large') items = items.filter((m) => m.context_length > 128000);
    if (priceFilter === 'cheap') items = items.filter((m) => m.price_input_per_m < 1);
    if (priceFilter === 'mid') items = items.filter((m) => m.price_input_per_m >= 1 && m.price_input_per_m <= 5);
    if (priceFilter === 'expensive') items = items.filter((m) => m.price_input_per_m > 5);

    items = [...items].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return items;
  }, [catalog, search, providerFilter, toolsFilter, contextFilter, priceFilter, sortKey, sortAsc]);

  const displayedCatalog = showAll ? filteredCatalog : filteredCatalog.slice(0, 50);

  async function handleApplySuggestion(s: OptimizationSuggestion) {
    await updateRouteApi(s.taskType, s.suggestedModel);
    loadData();
  }

  async function handleRouteChange(taskType: string, modelId: string) {
    await updateRouteApi(taskType, modelId);
    loadData();
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshCatalogApi();
      loadData();
    } finally {
      setRefreshing(false);
    }
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortAsc ? ' \u25B2' : ' \u25BC') : '';

  if (loading) {
    return (
      <div className="models-container">
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Models</h1>
        <p className="text-muted">Chargement...</p>
      </div>
    );
  }

  return (
    <div className="models-container">
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0 0 24px' }}>Models</h1>

      {/* Section 1: Optimization Suggestions */}
      {suggestions.length > 0 && (
        <section>
          <h2 className="models-section-title">Suggestions d&apos;optimisation</h2>
          <div className="models-suggestions-grid">
            {suggestions.map((s) => {
              const catalogEntry = catalog.find((m) => m.id === s.suggestedModel);
              return (
                <div key={s.taskType} className="card models-suggestion-card">
                  <div className="models-suggestion-header">
                    <span className="badge badge-cron">{s.taskType}</span>
                    <span className="badge badge-success">-{(s.savingsPercent ?? 0).toFixed(0)}%</span>
                  </div>
                  <div className="models-suggestion-body">
                    <div className="models-suggestion-arrow">
                      <span className="text-muted" style={{ fontSize: '0.8125rem' }}>{s.currentModel.split('/').pop()}</span>
                      <span style={{ color: 'var(--muted-foreground)' }}>&rarr;</span>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{s.suggestedName}</span>
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                      {formatPrice(s.currentPriceIn)}/{formatPrice(s.currentPriceOut)} &rarr; {formatPrice(s.suggestedPriceIn)}/{formatPrice(s.suggestedPriceOut)}
                    </div>
                    {catalogEntry && (
                      <div className="models-suggestion-details">
                        <span className="badge badge-muted">{catalogEntry.provider_slug}</span>
                        {catalogEntry.context_length > 0 && (
                          <span className="text-muted">{(catalogEntry.context_length / 1000).toFixed(0)}K ctx</span>
                        )}
                        {!!catalogEntry.supports_tools && <span className="badge badge-success" style={{ padding: '1px 6px', fontSize: '0.6875rem' }}>tools</span>}
                        {!!catalogEntry.supports_reasoning && <span className="badge badge-success" style={{ padding: '1px 6px', fontSize: '0.6875rem' }}>reasoning</span>}
                      </div>
                    )}
                  </div>
                  <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: '0.8125rem', marginTop: 8 }} onClick={() => handleApplySuggestion(s)}>
                    Appliquer
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 2: Routing Configuration */}
      {routes.length > 0 && (
        <section>
          <h2 className="models-section-title">Configuration du routage</h2>
          <div className="models-routes-grid">
            {routes.map((r) => (
              <div key={r.task_type} className="card models-route-card">
                <div className="models-route-header">
                  <span className="badge badge-muted">{r.task_type}</span>
                </div>
                <div className="model-selector" style={{ marginTop: 8 }}>
                  <select
                    value={r.model_id}
                    onChange={(e) => handleRouteChange(r.task_type, e.target.value)}
                  >
                    {/* Suggestions first (most relevant) */}
                    {r.suggestions.length > 0 && (
                      <optgroup label="Recommandés">
                        {r.suggestions.map((s) => (
                          <option key={s.modelId} value={s.modelId}>
                            {s.name} ({formatPrice(s.priceInput)}) ★
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {/* All other models */}
                    <optgroup label="Tous les modèles">
                      {catalog
                        .filter((m) => !r.suggestions.find((s) => s.modelId === m.id))
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({formatPrice(m.price_input_per_m)})
                          </option>
                        ))}
                    </optgroup>
                    {!catalog.find((m) => m.id === r.model_id) && (
                      <option value={r.model_id}>{r.model_id}</option>
                    )}
                  </select>
                </div>
                {r.suggestions.length > 0 && (
                  <div className="models-route-suggestions">
                    <span className="detail-label" style={{ marginTop: 8 }}>Top suggestions</span>
                    {r.suggestions.slice(0, 3).map((s) => (
                      <div key={s.modelId} className="models-route-suggestion-row">
                        <span style={{ fontSize: '0.8125rem' }}>{s.name}</span>
                        <span className="text-muted" style={{ fontSize: '0.75rem' }}>score: {s.score.toFixed(1)}</span>
                        <span className="text-muted" style={{ fontSize: '0.75rem' }}>{formatPrice(s.priceInput)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 3: Full Catalog */}
      <section>
        <div className="models-catalog-header">
          <h2 className="models-section-title" style={{ margin: 0 }}>Catalogue complet</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>
              {filteredCatalog.length}/{meta.count} modeles
              {meta.lastUpdate && ` | MAJ ${new Date(meta.lastUpdate).toLocaleDateString('fr-FR')}`}
            </span>
            <button
              className="btn btn-ghost"
              style={{ padding: '6px 12px', fontSize: '0.8125rem' }}
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'Rafraichissement...' : 'Rafraichir'}
            </button>
          </div>
        </div>

        <div className="filter-bar" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <input
            className="textarea filter-search"
            placeholder="Rechercher un modele..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 200, minHeight: 'auto', padding: '8px 12px' }}
          />
          <select
            className="filter-select"
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            style={{ padding: '8px 12px', background: 'var(--muted)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.875rem' }}
          >
            <option value="">Tous les providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            className="filter-select"
            value={toolsFilter}
            onChange={(e) => setToolsFilter(e.target.value as '' | 'yes' | 'no')}
            style={{ padding: '8px 12px', background: 'var(--muted)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.875rem' }}
          >
            <option value="">Tools: tous</option>
            <option value="yes">Tools: oui</option>
            <option value="no">Tools: non</option>
          </select>
          <select
            className="filter-select"
            value={contextFilter}
            onChange={(e) => setContextFilter(e.target.value as '' | 'small' | 'medium' | 'large')}
            style={{ padding: '8px 12px', background: 'var(--muted)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.875rem' }}
          >
            <option value="">Contexte: tous</option>
            <option value="small">&lt; 32K</option>
            <option value="medium">32K – 128K</option>
            <option value="large">&gt; 128K</option>
          </select>
          <select
            className="filter-select"
            value={priceFilter}
            onChange={(e) => setPriceFilter(e.target.value as '' | 'cheap' | 'mid' | 'expensive')}
            style={{ padding: '8px 12px', background: 'var(--muted)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.875rem' }}
          >
            <option value="">Prix: tous</option>
            <option value="cheap">&lt; $1/M</option>
            <option value="mid">$1–$5/M</option>
            <option value="expensive">&gt; $5/M</option>
          </select>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="recurring-table">
            <thead>
              <tr>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('name')}>Nom{sortIndicator('name')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('provider_slug')}>Provider{sortIndicator('provider_slug')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('price_input_per_m')}>Prix In{sortIndicator('price_input_per_m')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('price_output_per_m')}>Prix Out{sortIndicator('price_output_per_m')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('context_length')}>Contexte{sortIndicator('context_length')}</th>
                <th>Tools</th>
                <th>Cas d&apos;usage</th>
              </tr>
            </thead>
            <tbody>
              {displayedCatalog.map((m) => {
                const isExpanded = expandedId === m.id;
                const useCases = inferUseCases(m);
                return (
                  <>
                    <tr
                      key={m.id}
                      className="recurring-row"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setExpandedId(isExpanded ? null : m.id)}
                    >
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                        <span style={{ marginRight: 6, color: 'var(--muted-foreground)', fontSize: '0.7rem' }}>{isExpanded ? '▾' : '▸'}</span>
                        {m.name}
                      </td>
                      <td><span className="badge badge-muted">{m.provider_slug}</span></td>
                      <td style={{ fontSize: '0.8125rem' }}>{formatPrice(m.price_input_per_m)}</td>
                      <td style={{ fontSize: '0.8125rem' }}>{formatPrice(m.price_output_per_m)}</td>
                      <td className="text-muted" style={{ fontSize: '0.75rem' }}>{m.context_length > 0 ? `${(m.context_length / 1000).toFixed(0)}K` : '-'}</td>
                      <td>{m.supports_tools ? <span className="badge badge-success" style={{ padding: '1px 6px' }}>oui</span> : <span className="text-muted">-</span>}</td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {useCases.map((tag) => (
                            <span key={tag} className="badge badge-muted" style={{ padding: '1px 5px', fontSize: '0.6875rem' }}>{tag}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${m.id}-desc`}>
                        <td colSpan={7} style={{ padding: '8px 16px 12px 32px', background: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--foreground)', lineHeight: 1.5 }}>
                            {m.description
                              ? <p style={{ margin: '0 0 6px' }}>{m.description}</p>
                              : <p style={{ margin: '0 0 6px', color: 'var(--muted-foreground)' }}>Aucune description disponible.</p>
                            }
                            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
                              <span className="text-muted" style={{ fontSize: '0.75rem' }}>ID: <code style={{ fontFamily: 'var(--font-mono)' }}>{m.id}</code></span>
                              {m.supports_reasoning ? <span className="badge badge-success" style={{ padding: '1px 6px', fontSize: '0.6875rem' }}>reasoning</span> : null}
                              <a
                                href={`https://openrouter.ai/${m.id}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ fontSize: '0.75rem', color: 'var(--primary)', textDecoration: 'none' }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                Voir sur OpenRouter →
                              </a>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {displayedCatalog.length === 0 && (
                <tr><td colSpan={7} className="text-muted" style={{ textAlign: 'center', padding: 20 }}>Aucun modele trouve</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {!showAll && filteredCatalog.length > 50 && (
          <button
            className="btn btn-ghost"
            style={{ marginTop: 12, width: '100%' }}
            onClick={() => setShowAll(true)}
          >
            Afficher plus ({filteredCatalog.length - 50} restants)
          </button>
        )}
      </section>
    </div>
  );
}
