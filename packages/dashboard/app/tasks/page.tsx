'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  fetchRecurringTasks,
  fetchTaskExecutions,
  executeTaskNow,
  updateTaskApi,
  deleteTaskApi,
  type RecurringTaskInfo,
  type TaskExecution,
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

function StatusBadge({ task }: { task: RecurringTaskInfo }) {
  if (!task.cron_enabled) return <span className="badge badge-muted">Pause</span>;
  if (task.stats.errorCount > 0 && task.stats.lastRun) {
    return <span className="badge" style={{ background: '#ef4444', color: 'white' }}>Erreur</span>;
  }
  return <span className="badge badge-success">Actif</span>;
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

  const loadTasks = useCallback(async () => {
    try {
      const data = await fetchRecurringTasks();
      setTasks(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

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
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Taches recurrentes</h1>
        <span className="badge badge-muted">{tasks.length} automation{tasks.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted-foreground)' }}>Chargement...</p>
      ) : tasks.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--muted-foreground)' }}>Aucune tache recurrente configuree.</p>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>
            Creez une tache avec un cron_expression via le Chat ou l&apos;API.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="recurring-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Frequence</th>
                <th>Statut</th>
                <th>Prochaine exec.</th>
                <th>Derniere exec.</th>
                <th>Cout/mois</th>
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
                  <td>
                    <span className="badge badge-cron" style={{ fontSize: '0.6875rem' }}>
                      {task.cron_expression ? humanCron(task.cron_expression) : '-'}
                    </span>
                  </td>
                  <td><StatusBadge task={task} /></td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}>
                    {task.stats.nextRun
                      ? new Date(task.stats.nextRun).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                      : '-'}
                  </td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}>
                    {relativeTime(task.stats.lastRun)}
                  </td>
                  <td style={{ fontSize: '0.8125rem' }}>
                    {formatCost(task.stats.monthlyCost)}
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
                      <label className="toggle-switch" title={task.cron_enabled ? 'Mettre en pause' : 'Activer'}>
                        <input
                          type="checkbox"
                          checked={!!task.cron_enabled}
                          onChange={() => handleToggle(task)}
                        />
                        <span className="toggle-slider" />
                      </label>
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

                <div className="detail-cron-info">
                  <span className="detail-label" style={{ marginTop: 0 }}>Expression CRON</span>
                  <input
                    className="textarea"
                    style={{ height: 'auto', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
                    value={editingCron}
                    onChange={e => setEditingCron(e.target.value)}
                    onBlur={() => editingCron !== (selectedTask.cron_expression ?? '') && handleSaveConfig()}
                    placeholder="0 7 * * *"
                  />
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
