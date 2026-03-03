'use client';

import { useState, useEffect } from 'react';
import { fetchMemorySettings, updateMemorySettingsApi, fetchCatalog, fetchRoutes, updateRouteApi } from '../../lib/api';
import type { MemorySettingsInfo, CatalogModel, RouteWithSuggestions } from '../../lib/api';

const CRON_LEVELS: Array<{ taskType: string; label: string; description: string; examples: string }> = [
  { taskType: 'cron_simple',   label: 'Simple',   description: 'Action unique avec 1 outil',          examples: 'Météo, rappel, timer, statut' },
  { taskType: 'cron_moderate', label: 'Modérée',  description: 'Synthèse de 2-3 sources ou résumé',   examples: 'Briefing, résumé emails, rapport court' },
  { taskType: 'cron_task',     label: 'Complexe', description: 'Recherche web, analyse, multi-étapes', examples: 'Veille, rapport, décision' },
];

function formatPrice(perM: number): string {
  if (perM === 0) return 'Gratuit';
  return `$${perM.toFixed(2)}/M`;
}

export default function LlmSettingsPage() {
  const [settings, setSettings] = useState<MemorySettingsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [routes, setRoutes] = useState<RouteWithSuggestions[]>([]);
  const [savingRoute, setSavingRoute] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchMemorySettings(),
      fetchCatalog({ tools: 'true' }),
      fetchRoutes(),
    ]).then(([s, c, r]) => {
      setSettings(s);
      setCatalog(c.filter(m => m.modality?.includes('text')).sort((a, b) => a.name.localeCompare(b.name)));
      setRoutes(r);
    }).catch(() => setError('Erreur de chargement'))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      const updated = await updateMemorySettingsApi({ prefer_openrouter: !settings.prefer_openrouter });
      setSettings(updated);
    } catch {
      setError('Erreur de sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleRouteChange = async (taskType: string, modelId: string) => {
    setSavingRoute(taskType);
    try {
      await updateRouteApi(taskType, modelId);
      setRoutes(prev => prev.map(r => r.task_type === taskType ? { ...r, model_id: modelId } : r));
    } catch {
      setError('Erreur de sauvegarde du modèle');
    } finally {
      setSavingRoute(null);
    }
  };

  const getRouteModel = (taskType: string): string => {
    return routes.find(r => r.task_type === taskType)?.model_id ?? '';
  };

  const getModelInfo = (modelId: string): CatalogModel | undefined => {
    return catalog.find(m => m.id === modelId);
  };

  return (
    <div className="notif-settings-container">
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0 0 8px' }}>LLM Provider</h1>
      <p className="text-muted" style={{ margin: '0 0 24px', fontSize: '0.8125rem' }}>
        Configure le routage des appels LLM. Par défaut, les modèles Claude passent directement par Anthropic.
      </p>

      {error && <p className="text-muted" style={{ color: 'var(--destructive)', marginBottom: 16 }}>{error}</p>}

      {loading ? (
        <p className="text-muted">Chargement...</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* OpenRouter toggle */}
          <div className="card notif-settings-card">
            <h3 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: 600 }}>OpenRouter</h3>
            <p className="text-muted" style={{ margin: '0 0 16px', fontSize: '0.8125rem' }}>
              Quand actif, tous les appels LLM (y compris Claude) passent par OpenRouter pour une facturation unifiée. Whisper reste en direct.
            </p>
            <div className="memory-settings-section">
              <div className="memory-settings-field">
                <label>Router via OpenRouter</label>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings?.prefer_openrouter ?? false}
                    onChange={handleToggle}
                    disabled={saving}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
                Status : <span style={{ color: settings?.prefer_openrouter ? 'var(--success)' : 'var(--text-muted)' }}>
                  {settings?.prefer_openrouter ? 'Actif — tout passe par OpenRouter' : 'Inactif — routage standard (Anthropic direct pour Claude)'}
                </span>
              </div>
            </div>
          </div>

          {/* Cron task levels */}
          <div className="card notif-settings-card">
            <h3 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: 600 }}>Tâches agentiques</h3>
            <p className="text-muted" style={{ margin: '0 0 16px', fontSize: '0.8125rem' }}>
              Modèle utilisé selon la complexité estimée. Seuls les modèles avec support des outils sont listés.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
              {CRON_LEVELS.map((level, idx) => {
                const currentModelId = getRouteModel(level.taskType);
                const currentModel = getModelInfo(currentModelId);
                const isSaving = savingRoute === level.taskType;

                return (
                  <div key={level.taskType} style={{ padding: '12px 14px', background: 'var(--bg-secondary)', borderBottom: idx < CRON_LEVELS.length - 1 ? '1px solid var(--border)' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{level.label}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{level.description}</span>
                      </div>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontStyle: 'italic', whiteSpace: 'nowrap' }}>{level.examples}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <select
                        value={currentModelId}
                        onChange={e => handleRouteChange(level.taskType, e.target.value)}
                        disabled={isSaving || catalog.length === 0}
                        style={{ flex: '0 0 260px', padding: '5px 8px', fontSize: '0.8125rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6 }}
                      >
                        <option value="">— non configuré —</option>
                        {catalog.map(m => (
                          <option key={m.id} value={m.id}>{m.name} ({m.provider_slug})</option>
                        ))}
                      </select>

                      {currentModel && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {formatPrice(currentModel.price_input_per_m)} · {formatPrice(currentModel.price_output_per_m)}
                          </span>
                          {currentModel.description && (
                            <span> · {currentModel.description.length > 80 ? currentModel.description.slice(0, 80) + '…' : currentModel.description}</span>
                          )}
                        </span>
                      )}
                      {!currentModel && currentModelId && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{currentModelId}</span>
                      )}
                      {isSaving && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sauvegarde…</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
