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

type SortKey = 'name' | 'provider_slug' | 'price_input_per_m' | 'price_output_per_m' | 'context_length';

export default function ModelsPage() {
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);
  const [routes, setRoutes] = useState<RouteWithSuggestions[]>([]);
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [meta, setMeta] = useState<{ count: number; lastUpdate: string | null }>({ count: 0, lastUpdate: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
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
    items = [...items].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return items;
  }, [catalog, search, providerFilter, sortKey, sortAsc]);

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
            {suggestions.map((s) => (
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
                </div>
                <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: '0.8125rem', marginTop: 8 }} onClick={() => handleApplySuggestion(s)}>
                  Appliquer
                </button>
              </div>
            ))}
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
                    {catalog.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({formatPrice(m.price_input_per_m)})
                      </option>
                    ))}
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
              {meta.count} modeles
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

        <div className="filter-bar" style={{ marginBottom: 12 }}>
          <input
            className="textarea filter-search"
            placeholder="Rechercher un modele..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 240, minHeight: 'auto', padding: '8px 12px' }}
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
                <th>Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {displayedCatalog.map((m) => (
                <tr key={m.id} className="recurring-row">
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{m.name}</td>
                  <td><span className="badge badge-muted">{m.provider_slug}</span></td>
                  <td style={{ fontSize: '0.8125rem' }}>{formatPrice(m.price_input_per_m)}</td>
                  <td style={{ fontSize: '0.8125rem' }}>{formatPrice(m.price_output_per_m)}</td>
                  <td className="text-muted" style={{ fontSize: '0.75rem' }}>{m.context_length > 0 ? `${(m.context_length / 1000).toFixed(0)}K` : '-'}</td>
                  <td>{m.supports_tools ? <span className="badge badge-success" style={{ padding: '1px 6px' }}>oui</span> : <span className="text-muted">-</span>}</td>
                  <td>{m.supports_reasoning ? <span className="badge badge-success" style={{ padding: '1px 6px' }}>oui</span> : <span className="text-muted">-</span>}</td>
                </tr>
              ))}
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
