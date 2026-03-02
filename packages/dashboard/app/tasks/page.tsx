'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  fetchRecurringTasks,
  fetchTaskExecutions,
  executeTaskNow,
  updateTaskApi,
  deleteTaskApi,
  fetchModels,
  type RecurringTaskInfo,
  type TaskExecution,
  type ModelInfo,
} from '../lib/api';

function humanCron(expr: string): string {
  const parts = expr.split(' ');
  if (parts.length !== 5) return expr;
  const [min, hour, dom, , dow] = parts;
  const dayNames: Record<string, string> = { '0': 'dim', '1': 'lun', '2': 'mar', '3': 'mer', '4': 'jeu', '5': 'ven', '6': 'sam', '7': 'dim' };
  if (dow !== '*' && dom === '*' && hour !== '*') return `${dayNames[dow!] ?? `jour ${dow}`} ${hour}h${min === '0' ? '' : min}`;
  if (dow === '*' && dom === '*' && hour !== '*') return `Tous les jours ${hour}h${min === '0' ? '' : min}`;
  if (dom !== '*' && dow === '*' && hour !== '*') return `Le ${dom} du mois ${hour}h${min === '0' ? '' : min}`;
  return expr;
}

type CronFreq = 'daily' | 'weekly' | 'monthly' | 'custom';

function parseCron(expr: string): { freq: CronFreq; hour: string; minute: string; dow: string; dom: string } {
  const parts = expr.split(' ');
  if (parts.length !== 5) return { freq: 'custom', hour: '8', minute: '0', dow: '1', dom: '1' };
  const [min, hour, dom, , dow] = parts;
  if (dow !== '*' && dom === '*') return { freq: 'weekly', hour: hour!, minute: min!, dow: dow!, dom: '1' };
  if (dom !== '*' && dow === '*') return { freq: 'monthly', hour: hour!, minute: min!, dow: '1', dom: dom! };
  if (hour !== '*') return { freq: 'daily', hour: hour!, minute: min!, dow: '1', dom: '1' };
  return { freq: 'custom', hour: '8', minute: '0', dow: '1', dom: '1' };
}

function buildCron(freq: CronFreq, hour: string, minute: string, dow: string, dom: string): string {
  if (freq === 'daily') return `${minute} ${hour} * * *`;
  if (freq === 'weekly') return `${minute} ${hour} * * ${dow}`;
  if (freq === 'monthly') return `${minute} ${hour} ${dom} * *`;
  return `${minute} ${hour} * * *`;
}

const FREQ_LABELS: Record<CronFreq, string> = { daily: 'Tous les jours', weekly: 'Chaque semaine', monthly: 'Chaque mois', custom: 'Personnalisé' };
const DOW_LABELS: Record<string, string> = { '1': 'Lundi', '2': 'Mardi', '3': 'Mercredi', '4': 'Jeudi', '5': 'Vendredi', '6': 'Samedi', '0': 'Dimanche' };

function formatDuration(ms: number | null): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number | null | undefined): string {
  if (!cost) return '-';
  if (cost < 0.01) return `<$0.01`;
  return `$${cost.toFixed(2)}`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "A l'instant";
  if (mins < 60) return `Il y a ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Il y a ${days}j`;
}

function CronEditor({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const parsed = parseCron(value);
  const [freq, setFreq] = useState<CronFreq>(parsed.freq);
  const [hour, setHour] = useState(parsed.hour);
  const [minute, setMinute] = useState(parsed.minute);
  const [dow, setDow] = useState(parsed.dow);
  const [dom, setDom] = useState(parsed.dom);
  const [showRaw, setShowRaw] = useState(parsed.freq === 'custom');

  // Sync when external value changes (task selection)
  useEffect(() => {
    const p = parseCron(value);
    setFreq(p.freq);
    setHour(p.hour);
    setMinute(p.minute);
    setDow(p.dow);
    setDom(p.dom);
    setShowRaw(p.freq === 'custom');
  }, [value]);

  function emit(f: CronFreq, h: string, m: string, d: string, dm: string) {
    if (f === 'custom') return;
    onChange(buildCron(f, h, m, d, dm));
  }

  const selectStyle = { padding: '6px 10px', fontSize: '0.8125rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '6px' };

  if (showRaw) {
    return (
      <div className="detail-cron-info">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="detail-label" style={{ marginTop: 0 }}>Expression CRON</span>
          <button className="btn btn-sm" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={() => { setShowRaw(false); setFreq('daily'); emit('daily', hour, minute, dow, dom); }}>Mode simple</button>
        </div>
        <input
          className="textarea"
          style={{ height: 'auto', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0 7 * * *"
        />
      </div>
    );
  }

  return (
    <div className="detail-cron-info">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="detail-label" style={{ marginTop: 0 }}>Planification</span>
        <button className="btn btn-sm" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={() => setShowRaw(true)}>CRON brut</button>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <select style={selectStyle} value={freq} onChange={e => { const f = e.target.value as CronFreq; setFreq(f); emit(f, hour, minute, dow, dom); }}>
          {Object.entries(FREQ_LABELS).filter(([k]) => k !== 'custom').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {freq === 'weekly' && (
          <select style={selectStyle} value={dow} onChange={e => { setDow(e.target.value); emit(freq, hour, minute, e.target.value, dom); }}>
            {Object.entries(DOW_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        {freq === 'monthly' && (
          <select style={selectStyle} value={dom} onChange={e => { setDom(e.target.value); emit(freq, hour, minute, dow, e.target.value); }}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={String(d)}>Le {d}</option>)}
          </select>
        )}
        <span style={{ alignSelf: 'center', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>à</span>
        <select style={{ ...selectStyle, width: '70px' }} value={hour} onChange={e => { setHour(e.target.value); emit(freq, e.target.value, minute, dow, dom); }}>
          {Array.from({ length: 24 }, (_, i) => <option key={i} value={String(i)}>{String(i).padStart(2, '0')}h</option>)}
        </select>
        <select style={{ ...selectStyle, width: '70px' }} value={minute} onChange={e => { setMinute(e.target.value); emit(freq, hour, e.target.value, dow, dom); }}>
          {[0, 5, 10, 15, 20, 30, 45].map(m => <option key={m} value={String(m)}>{String(m).padStart(2, '0')}</option>)}
        </select>
      </div>
    </div>
  );
}

function StatusBadge({ task }: { task: RecurringTaskInfo }) {
  // One-shot scheduled task
  if (!task.cron_expression && task.cron_prompt) {
    if (task.status === 'done') return <span className="badge badge-success">Termine</span>;
    if (task.status === 'failed') return <span className="badge" style={{ background: '#ef4444', color: 'white' }}>Echoue</span>;
    if (task.status === 'in_progress') return <span className="badge" style={{ background: '#f59e0b', color: 'white' }}>En cours</span>;
    return <span className="badge badge-muted">Planifie</span>;
  }
  // Recurring task
  if (!task.cron_enabled) return <span className="badge badge-muted">Pause</span>;
  if (task.stats.errorCount > 0 && task.stats.lastRun) {
    return <span className="badge" style={{ background: '#ef4444', color: 'white' }}>Erreur</span>;
  }
  return <span className="badge badge-success">Actif</span>;
}

function TypeBadge({ task }: { task: RecurringTaskInfo }) {
  if (task.cron_expression) return <span className="badge badge-outline" style={{ fontSize: '0.625rem' }}>Recurrent</span>;
  return <span className="badge badge-outline" style={{ fontSize: '0.625rem' }}>One-shot</span>;
}

export default function RecurringTasksPage() {
  const [tasks, setTasks] = useState<RecurringTaskInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<RecurringTaskInfo | null>(null);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [executing, setExecuting] = useState<string | null>(null);
  const [editingCron, setEditingCron] = useState('');
  const [editingPrompt, setEditingPrompt] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);

  const loadTasks = useCallback(async () => {
    try {
      const data = await fetchRecurringTasks();
      setTasks(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTasks(); fetchModels().then(setModels).catch(() => {}); }, [loadTasks]);

  useEffect(() => {
    if (!selectedTask) return;
    setEditingCron(selectedTask.cron_expression ?? '');
    setEditingPrompt(selectedTask.cron_prompt ?? '');
    setConfirmDelete(false);
    fetchTaskExecutions(selectedTask.id, 20)
      .then(setExecutions)
      .catch(() => setExecutions([]));
  }, [selectedTask]);

  async function handleExecute(taskId: string) {
    setExecuting(taskId);
    try {
      await executeTaskNow(taskId);
      await loadTasks();
      if (selectedTask?.id === taskId) {
        fetchTaskExecutions(taskId, 20).then(setExecutions).catch(() => {});
      }
    } catch (err) { console.error(err); }
    finally { setExecuting(null); }
  }

  async function handleToggle(task: RecurringTaskInfo) {
    try {
      await updateTaskApi(task.id, { cron_enabled: !task.cron_enabled });
      await loadTasks();
    } catch (err) { console.error(err); }
  }

  async function handleSaveConfig() {
    if (!selectedTask) return;
    try {
      await updateTaskApi(selectedTask.id, {
        cron_expression: editingCron || null,
        cron_prompt: editingPrompt || null,
      });
      await loadTasks();
      const updated = tasks.find(t => t.id === selectedTask.id);
      if (updated) setSelectedTask(updated);
    } catch (err) { console.error(err); }
  }

  async function saveCronDirect(cron: string) {
    if (!selectedTask) return;
    try {
      await updateTaskApi(selectedTask.id, { cron_expression: cron || null });
      await loadTasks();
    } catch (err) { console.error(err); }
  }

  async function handleDelete() {
    if (!selectedTask) return;
    try {
      await deleteTaskApi(selectedTask.id);
      setSelectedTask(null);
      await loadTasks();
    } catch (err) { console.error(err); }
  }

  // Update selectedTask ref when tasks reload
  useEffect(() => {
    if (selectedTask) {
      const updated = tasks.find(t => t.id === selectedTask.id);
      if (updated) setSelectedTask(updated);
    }
  }, [tasks]);

  return (
    <div className="tasks-container">
      <div className="tasks-header">
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Taches agent</h1>
        <span className="badge badge-muted">{tasks.length} tache{tasks.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted-foreground)' }}>Chargement...</p>
      ) : tasks.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--muted-foreground)' }}>Aucune tache agent configuree.</p>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>
            Demandez a l&apos;agent de planifier une tache via le Chat ou WhatsApp.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="recurring-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Type</th>
                <th>Frequence</th>
                <th>Statut</th>
                <th>Prochaine exec.</th>
                <th>Derniere exec.</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(task => (
                <tr
                  key={task.id}
                  className={`recurring-row ${selectedTask?.id === task.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTask(task)}
                >
                  <td>
                    <span className="recurring-title">{task.title}</span>
                  </td>
                  <td><TypeBadge task={task} /></td>
                  <td>
                    {task.cron_expression ? (
                      <span className="badge badge-cron" style={{ fontSize: '0.6875rem' }}>
                        {humanCron(task.cron_expression)}
                      </span>
                    ) : task.due_at ? (
                      <span style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}>
                        {new Date(task.due_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    ) : '-'}
                  </td>
                  <td><StatusBadge task={task} /></td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}>
                    {task.cron_expression && task.stats.nextRun
                      ? new Date(task.stats.nextRun).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                      : !task.cron_expression && task.due_at && task.status !== 'done'
                        ? new Date(task.due_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                        : '-'}
                  </td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}>
                    {relativeTime(task.stats.lastRun)}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        onClick={() => handleExecute(task.id)}
                        disabled={executing === task.id || !task.cron_prompt}
                        title="Executer maintenant"
                      >
                        {executing === task.id ? (
                          <span className="chat-tool-spinner" />
                        ) : '\u25B6\uFE0F'}
                      </button>
                      {task.cron_expression && (
                        <label className="toggle-switch" title={task.cron_enabled ? 'Mettre en pause' : 'Activer'}>
                          <input
                            type="checkbox"
                            checked={!!task.cron_enabled}
                            onChange={() => handleToggle(task)}
                          />
                          <span className="toggle-slider" />
                        </label>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail panel */}
      {selectedTask && (
        <div className="detail-panel-overlay" onClick={() => setSelectedTask(null)}>
          <div className="detail-panel" onClick={e => e.stopPropagation()}>
            <div className="detail-panel-header">
              <h3>{selectedTask.title}</h3>
              <button className="btn btn-ghost" onClick={() => setSelectedTask(null)}>&#x2715;</button>
            </div>

            <div className="detail-panel-body">
              {/* Stats */}
              <label className="detail-label">Statistiques</label>
              <div className="recurring-stats-grid">
                <div className="recurring-stat">
                  <span className="recurring-stat-value">{selectedTask.stats.totalRuns}</span>
                  <span className="recurring-stat-label">Executions</span>
                </div>
                <div className="recurring-stat">
                  <span className="recurring-stat-value">
                    {selectedTask.stats.totalRuns > 0 ? `${Math.round(selectedTask.stats.successRate * 100)}%` : '-'}
                  </span>
                  <span className="recurring-stat-label">Succes</span>
                </div>
                <div className="recurring-stat">
                  <span className="recurring-stat-value">{formatDuration(selectedTask.stats.avgDurationMs)}</span>
                  <span className="recurring-stat-label">Duree moy.</span>
                </div>
                <div className="recurring-stat">
                  <span className="recurring-stat-value">{formatCost(selectedTask.stats.monthlyCost)}</span>
                  <span className="recurring-stat-label">Cout/mois</span>
                </div>
              </div>

              {/* Configuration */}
              <label className="detail-label">Configuration</label>
              <div className="detail-cron-section">
                {selectedTask.cron_expression ? (
                  <>
                    <div className="detail-cron-toggle">
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={!!selectedTask.cron_enabled}
                          onChange={() => handleToggle(selectedTask)}
                        />
                        <span className="toggle-slider" />
                      </label>
                      <span>{selectedTask.cron_enabled ? 'Active' : 'En pause'}</span>
                    </div>

                    <CronEditor
                      value={editingCron}
                      onChange={(cron) => {
                        setEditingCron(cron);
                        if (cron !== (selectedTask.cron_expression ?? '')) {
                          saveCronDirect(cron);
                        }
                      }}
                    />
                  </>
                ) : (
                  <div className="detail-cron-info">
                    <span className="detail-label" style={{ marginTop: 0 }}>Execution prevue</span>
                    <span style={{ fontSize: '0.875rem' }}>
                      {selectedTask.due_at
                        ? new Date(selectedTask.due_at).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
                        : 'Non planifiee'}
                    </span>
                    <span className="badge badge-outline" style={{ fontSize: '0.625rem', marginTop: 4, alignSelf: 'flex-start' }}>
                      Tache ponctuelle
                    </span>
                  </div>
                )}

                <div className="detail-cron-info">
                  <span className="detail-label" style={{ marginTop: 0 }}>Modèle LLM</span>
                  <select
                    style={{ padding: '6px 10px', fontSize: '0.8125rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '6px', width: '100%' }}
                    value={selectedTask.model ?? ''}
                    onChange={async (e) => {
                      const model = e.target.value || null;
                      try {
                        await updateTaskApi(selectedTask.id, { model });
                        await loadTasks();
                      } catch (err) { console.error(err); }
                    }}
                  >
                    <option value="">Auto (router par défaut)</option>
                    {models.map(m => <option key={m.id} value={m.id}>{m.label} ({m.provider})</option>)}
                  </select>
                </div>

                <div className="detail-cron-info">
                  <span className="detail-label" style={{ marginTop: 0 }}>Canaux de notification</span>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {['whatsapp', 'mission_control'].map(ch => {
                      const channels: string[] = (() => { try { return JSON.parse(selectedTask.notify_channels || '[]'); } catch { return []; } })();
                      const checked = channels.includes(ch);
                      return (
                        <label key={ch} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={async () => {
                              const next = checked ? channels.filter(c => c !== ch) : [...channels, ch];
                              try {
                                await updateTaskApi(selectedTask.id, { notify_channels: next });
                                await loadTasks();
                              } catch (err) { console.error(err); }
                            }}
                          />
                          {ch === 'whatsapp' ? 'WhatsApp' : 'Mission Control'}
                        </label>
                      );
                    })}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)' }}>
                    En plus du canal principal ({selectedTask.channel})
                  </span>
                </div>

                <div className="detail-cron-info">
                  <span className="detail-label" style={{ marginTop: 0 }}>Prompt</span>
                  <textarea
                    className="textarea"
                    rows={3}
                    style={{ fontSize: '0.8125rem' }}
                    value={editingPrompt}
                    onChange={e => setEditingPrompt(e.target.value)}
                    onBlur={() => editingPrompt !== (selectedTask.cron_prompt ?? '') && handleSaveConfig()}
                    placeholder="Prompt envoye a l'agent..."
                  />
                </div>
              </div>

              {/* Timeline */}
              <label className="detail-label">Historique d&apos;executions</label>
              {executions.length === 0 ? (
                <p style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>Aucune execution enregistree.</p>
              ) : (
                <div className="recurring-timeline">
                  {executions.map(exec => (
                    <div key={exec.id} className={`recurring-exec ${exec.status}`}>
                      <div className="recurring-exec-header">
                        <span className={`badge ${exec.status === 'success' ? 'badge-success' : ''}`}
                          style={exec.status === 'error' ? { background: '#ef4444', color: 'white' } : undefined}
                        >
                          {exec.status === 'success' ? 'OK' : 'Erreur'}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
                          {new Date(exec.created_at).toLocaleString('fr-FR', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
                          {formatDuration(exec.duration_ms)}
                        </span>
                        {exec.cost_estimate ? (
                          <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
                            {formatCost(exec.cost_estimate)}
                          </span>
                        ) : null}
                      </div>
                      {exec.error_message && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--destructive)', marginTop: 4 }}>
                          {exec.error_message}
                        </div>
                      )}
                      {exec.result_summary && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', marginTop: 4 }}>
                          {exec.result_summary}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Execute button */}
              <button
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 8 }}
                disabled={executing === selectedTask.id || !selectedTask.cron_prompt}
                onClick={() => handleExecute(selectedTask.id)}
              >
                {executing === selectedTask.id ? (
                  <>
                    <span className="chat-tool-spinner" />
                    Execution en cours...
                  </>
                ) : (
                  'Executer maintenant'
                )}
              </button>
            </div>

            <div className="detail-panel-footer">
              {!confirmDelete ? (
                <button className="btn btn-ghost text-destructive" onClick={() => setConfirmDelete(true)}>
                  Supprimer
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Annuler</button>
                  <button className="btn" style={{ background: 'var(--destructive)', color: 'white' }} onClick={handleDelete}>
                    Confirmer
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
