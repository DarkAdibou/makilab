'use client';

import { useState, useEffect } from 'react';
import { fetchCostSummary, fetchCostHistory, fetchRecentUsage } from '../lib/api';
import type { CostSummary, CostHistoryPoint, LlmUsageEntry } from '../lib/api';

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

export default function CostsPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [history, setHistory] = useState<CostHistoryPoint[]>([]);
  const [recent, setRecent] = useState<LlmUsageEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchCostSummary(period),
      fetchCostHistory(period === 'day' ? 1 : period === 'week' ? 7 : period === 'year' ? 365 : 30),
      fetchRecentUsage(30),
    ]).then(([s, h, r]) => {
      setSummary(s);
      setHistory(h);
      setRecent(r);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [period]);

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
            {/* By Model */}
            <div className="card command-section">
              <h2>Par modele</h2>
              {summary.byModel.length === 0 ? (
                <p className="text-muted">Aucune donnee</p>
              ) : (
                summary.byModel.map(m => (
                  <div key={m.model} className="costs-breakdown-row">
                    <span className="costs-breakdown-label">{m.model.split('/').pop()}</span>
                    <span className="costs-breakdown-bar-wrapper">
                      <span
                        className="costs-breakdown-bar"
                        style={{ width: `${Math.max((m.cost / summary.totalCost) * 100, 2)}%` }}
                      />
                    </span>
                    <span className="costs-breakdown-value">{formatCost(m.cost)}</span>
                    <span className="text-muted" style={{ fontSize: '0.75rem', minWidth: 50, textAlign: 'right' }}>{m.calls} calls</span>
                  </div>
                ))
              )}
            </div>

            {/* By Task Type */}
            <div className="card command-section">
              <h2>Par type</h2>
              {summary.byTaskType.length === 0 ? (
                <p className="text-muted">Aucune donnee</p>
              ) : (
                summary.byTaskType.map(t => (
                  <div key={t.taskType} className="costs-breakdown-row">
                    <span className="costs-breakdown-label">{t.taskType}</span>
                    <span className="costs-breakdown-bar-wrapper">
                      <span
                        className="costs-breakdown-bar"
                        style={{ width: `${Math.max((t.cost / summary.totalCost) * 100, 2)}%` }}
                      />
                    </span>
                    <span className="costs-breakdown-value">{formatCost(t.cost)}</span>
                    <span className="text-muted" style={{ fontSize: '0.75rem', minWidth: 50, textAlign: 'right' }}>{t.calls} calls</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Daily chart (CSS bars) */}
          {history.length > 0 && (
            <div className="card command-section">
              <h2>Historique quotidien</h2>
              <div className="costs-chart">
                {history.map(h => (
                  <div key={h.date} className="costs-chart-bar-wrapper" title={`${h.date}: ${formatCost(h.cost)} (${h.calls} calls)`}>
                    <div
                      className="costs-chart-bar"
                      style={{ height: `${Math.max((h.cost / maxCost) * 100, 2)}%` }}
                    />
                    <span className="costs-chart-label">{h.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent calls */}
          <div className="card command-section">
            <h2>Derniers appels</h2>
            <div className="costs-recent-table">
              <table className="recurring-table">
                <thead>
                  <tr>
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
                    <tr key={r.id} className="recurring-row">
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{r.model.split('/').pop()}</td>
                      <td><span className="badge badge-muted">{r.task_type}</span></td>
                      <td className="text-muted" style={{ fontSize: '0.75rem' }}>{formatTokens(r.tokens_in)} / {formatTokens(r.tokens_out)}</td>
                      <td>{formatCost(r.cost_usd)}</td>
                      <td className="text-muted" style={{ fontSize: '0.75rem' }}>{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '-'}</td>
                      <td className="text-muted" style={{ fontSize: '0.75rem' }}>{new Date(r.created_at).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</td>
                    </tr>
                  ))}
                  {recent.length === 0 && (
                    <tr><td colSpan={6} className="text-muted" style={{ textAlign: 'center', padding: 20 }}>Aucun appel enregistre</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <p className="text-muted">Erreur de chargement</p>
      )}
    </div>
  );
}
