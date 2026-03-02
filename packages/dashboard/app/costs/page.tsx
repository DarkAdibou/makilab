'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { fetchCostSummary, fetchCostHistory, fetchRecentUsage, fetchSuggestions, fetchUsageContext } from '../lib/api';
import type { CostSummary, CostHistoryPoint, LlmUsageEntry, OptimizationSuggestion, AgentEvent } from '../lib/api';

type Period = 'day' | 'week' | 'month' | 'year';

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const PAGE_SIZE = 50;

export default function CostsPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [history, setHistory] = useState<CostHistoryPoint[]>([]);
  const [recent, setRecent] = useState<LlmUsageEntry[]>([]);
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [contextCache, setContextCache] = useState<Record<number, AgentEvent[]>>({});
  const [contextLoading, setContextLoading] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setRecent([]);
    setHasMore(true);
    Promise.all([
      fetchCostSummary(period),
      fetchCostHistory(period === 'day' ? 1 : period === 'week' ? 7 : period === 'year' ? 365 : 30),
      fetchRecentUsage(PAGE_SIZE, 0),
      fetchSuggestions().catch(() => []),
    ]).then(([s, h, r, sg]) => {
      setSummary(s);
      setHistory(h);
      setRecent(r);
      setHasMore(r.length >= PAGE_SIZE);
      setSuggestions(sg);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [period]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const more = await fetchRecentUsage(PAGE_SIZE, recent.length);
      setRecent((prev) => [...prev, ...more]);
      setHasMore(more.length >= PAGE_SIZE);
    } catch { /* ignore */ }
    setLoadingMore(false);
  }

  async function toggleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!contextCache[id]) {
      setContextLoading(id);
      try {
        const events = await fetchUsageContext(id);
        setContextCache((prev) => ({ ...prev, [id]: events }));
      } catch { /* ignore */ }
      setContextLoading(null);
    }
  }

  const maxCost = Math.max(...history.map(h => h.cost), 0.001);

  return (
    <div className="costs-container">
      <div className="costs-header">
        <h1>Costs</h1>
        <div className="costs-period-selector">
          {(['day', 'week', 'month', 'year'] as Period[]).map(p => (
            <button
              key={p}
              className={`btn ${p === period ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPeriod(p)}
              style={{ padding: '6px 14px', fontSize: '0.8125rem' }}
            >
              {p === 'day' ? '24h' : p === 'week' ? '7j' : p === 'month' ? '30j' : 'An'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Chargement...</p>
      ) : summary ? (
        <>
          {/* Stat cards */}
          <div className="stat-grid">
            <div className="card stat-card">
              <div className="stat-card-value">{formatCost(summary.totalCost)}</div>
              <div className="stat-card-label">Total</div>
            </div>
            <div className="card stat-card">
              <div className="stat-card-value">{summary.totalCalls}</div>
              <div className="stat-card-label">Appels</div>
            </div>
            <div className="card stat-card">
              <div className="stat-card-value">{formatTokens(summary.totalTokensIn)}</div>
              <div className="stat-card-label">Tokens In</div>
            </div>
            <div className="card stat-card">
              <div className="stat-card-value">{formatTokens(summary.totalTokensOut)}</div>
              <div className="stat-card-label">Tokens Out</div>
            </div>
          </div>

          {/* Breakdowns */}
          <div className="command-grid">
            <div className="card command-section">
              <h2>Par modele</h2>
              {summary.byModel.length === 0 ? (
                <p className="text-muted">Aucune donnee</p>
              ) : (
                summary.byModel.map(m => (
                  <div key={m.model} className="costs-breakdown-row">
                    <span className="costs-breakdown-label">{m.model.split('/').pop()}</span>
                    <span className="costs-breakdown-bar-wrapper">
                      <span className="costs-breakdown-bar" style={{ width: `${Math.max((m.cost / summary.totalCost) * 100, 2)}%` }} />
                    </span>
                    <span className="costs-breakdown-value">{formatCost(m.cost)}</span>
                    <span className="text-muted" style={{ fontSize: '0.75rem', minWidth: 50, textAlign: 'right' }}>{m.calls} calls</span>
                  </div>
                ))
              )}
            </div>
            <div className="card command-section">
              <h2>Par type</h2>
              {summary.byTaskType.length === 0 ? (
                <p className="text-muted">Aucune donnee</p>
              ) : (
                summary.byTaskType.map(t => (
                  <div key={t.taskType} className="costs-breakdown-row">
                    <span className="costs-breakdown-label">{t.taskType}</span>
                    <span className="costs-breakdown-bar-wrapper">
                      <span className="costs-breakdown-bar" style={{ width: `${Math.max((t.cost / summary.totalCost) * 100, 2)}%` }} />
                    </span>
                    <span className="costs-breakdown-value">{formatCost(t.cost)}</span>
                    <span className="text-muted" style={{ fontSize: '0.75rem', minWidth: 50, textAlign: 'right' }}>{t.calls} calls</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Daily chart */}
          {history.length > 0 && (
            <div className="card command-section">
              <h2>Historique quotidien</h2>
              <div className="costs-chart">
                {history.map(h => (
                  <div key={h.date} className="costs-chart-bar-wrapper" title={`${h.date}: ${formatCost(h.cost)} (${h.calls} calls)`}>
                    <div className="costs-chart-bar" style={{ height: `${Math.max((h.cost / maxCost) * 100, 2)}%` }} />
                    <span className="costs-chart-label">{h.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Potential savings — BEFORE recent calls */}
          {suggestions.length > 0 && (
            <div className="card command-section">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 style={{ margin: 0 }}>Economies potentielles</h2>
                <Link href="/models" className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: '0.8125rem', textDecoration: 'none' }}>
                  Voir Models &rarr;
                </Link>
              </div>
              {suggestions.map(s => (
                <div key={s.taskType} className="costs-savings-row">
                  <span className="badge badge-cron" style={{ minWidth: 80, textAlign: 'center' }}>{s.taskType}</span>
                  <span className="costs-breakdown-label" style={{ minWidth: 100 }}>{s.currentModel.split('/').pop()}</span>
                  <span style={{ color: 'var(--muted-foreground)' }}>&rarr;</span>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{s.suggestedName}</span>
                  <span className="costs-breakdown-bar-wrapper" style={{ maxWidth: 120 }}>
                    <span className="costs-breakdown-bar" style={{ width: `${Math.min(s.savingsPercent ?? 0, 100)}%`, background: '#22c55e' }} />
                  </span>
                  <span className="badge badge-success">-{(s.savingsPercent ?? 0).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}

          {/* All calls — accordion + pagination */}
          <div className="card command-section">
            <h2>Historique des appels</h2>
            <div className="costs-recent-table">
              <table className="recurring-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}></th>
                    <th>Modele</th>
                    <th>Type</th>
                    <th>Tokens</th>
                    <th>Cout</th>
                    <th>Duree</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map(r => (
                    <UsageRow
                      key={r.id}
                      entry={r}
                      expanded={expandedId === r.id}
                      onToggle={() => toggleExpand(r.id)}
                      context={contextCache[r.id]}
                      loading={contextLoading === r.id}
                    />
                  ))}
                  {recent.length === 0 && (
                    <tr><td colSpan={7} className="text-muted" style={{ textAlign: 'center', padding: 20 }}>Aucun appel enregistre</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {hasMore && (
              <button
                className="btn btn-ghost"
                style={{ marginTop: 12, width: '100%' }}
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Chargement...' : 'Charger plus'}
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="text-muted">Erreur de chargement</p>
      )}
    </div>
  );
}

function UsageRow({ entry: r, expanded, onToggle, context, loading }: {
  entry: LlmUsageEntry;
  expanded: boolean;
  onToggle: () => void;
  context?: AgentEvent[];
  loading: boolean;
}) {
  return (
    <>
      <tr className="recurring-row costs-usage-row" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td style={{ width: 28, padding: '8px 4px' }}>
          <ChevronDown size={14} style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s', color: 'var(--muted-foreground)' }} />
        </td>
        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{r.model.split('/').pop()}</td>
        <td><span className="badge badge-muted">{r.task_type}</span></td>
        <td className="text-muted" style={{ fontSize: '0.75rem' }}>{formatTokens(r.tokens_in)} / {formatTokens(r.tokens_out)}</td>
        <td>{formatCost(r.cost_usd)}</td>
        <td className="text-muted" style={{ fontSize: '0.75rem' }}>{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '-'}</td>
        <td className="text-muted" style={{ fontSize: '0.75rem' }}>{new Date(r.created_at).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</td>
      </tr>
      {expanded && (
        <tr className="costs-context-row">
          <td colSpan={7} style={{ padding: '0 12px 12px 40px', background: 'var(--muted)' }}>
            <div className="costs-context-details">
              <div className="costs-context-meta">
                <span className="text-muted" style={{ fontSize: '0.75rem' }}>Provider: <strong>{r.provider}</strong></span>
                <span className="text-muted" style={{ fontSize: '0.75rem' }}>Channel: <strong>{r.channel ?? '-'}</strong></span>
                {r.task_id && <span className="text-muted" style={{ fontSize: '0.75rem' }}>Task: <strong>{r.task_id.slice(0, 8)}</strong></span>}
              </div>
              {loading ? (
                <p className="text-muted" style={{ fontSize: '0.75rem', margin: '8px 0 0' }}>Chargement contexte...</p>
              ) : context && context.length > 0 ? (
                <div className="costs-context-events">
                  <span className="detail-label" style={{ marginTop: 8 }}>Activite associee</span>
                  {context.map((e) => (
                    <div key={e.id} className="costs-context-event">
                      <span className={`badge ${e.type === 'error' ? 'badge-destructive' : 'badge-muted'}`} style={{ fontSize: '0.6875rem', padding: '1px 6px' }}>
                        {e.type}
                      </span>
                      {e.subagent && <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>{e.subagent}{e.action ? ` \u2192 ${e.action}` : ''}</span>}
                      {e.success !== null && (
                        <span className={`badge ${e.success ? 'badge-success' : 'badge-destructive'}`} style={{ fontSize: '0.625rem', padding: '1px 4px' }}>
                          {e.success ? 'OK' : 'Echec'}
                        </span>
                      )}
                      {e.duration_ms !== null && <span className="text-muted" style={{ fontSize: '0.6875rem' }}>{e.duration_ms}ms</span>}
                      {e.input && (
                        <pre className="costs-context-pre">{e.input.length > 200 ? e.input.slice(0, 200) + '...' : e.input}</pre>
                      )}
                    </div>
                  ))}
                </div>
              ) : context ? (
                <p className="text-muted" style={{ fontSize: '0.75rem', margin: '8px 0 0' }}>Aucune activite associee</p>
              ) : null}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
