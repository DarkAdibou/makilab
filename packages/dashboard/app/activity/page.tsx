'use client';
import { useState, useEffect } from 'react';
import { fetchActivity, type AgentEvent } from '../lib/api';

const TYPE_ICONS: Record<string, string> = {
  tool_call: '\u{1F527}',
  tool_result: '\u{1F4E4}',
  message: '\u{1F4AC}',
  error: '\u274C',
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "a l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  return `il y a ${Math.floor(hours / 24)}j`;
}

export default function ActivityPage() {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchActivity(200, typeFilter || undefined).then(setEvents).catch(console.error);
  }, [typeFilter]);

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="activity-container">
      <div className="activity-header">
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Activite</h1>
        <select className="textarea filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">Tous les types</option>
          <option value="tool_call">Tool calls</option>
          <option value="tool_result">Resultats</option>
          <option value="error">Erreurs</option>
        </select>
      </div>
      <div className="activity-timeline">
        {events.length === 0 && <p className="text-muted">Aucune activite enregistree.</p>}
        {events.map(ev => (
          <div key={ev.id} className="activity-event" onClick={() => toggleExpand(ev.id)}>
            <div className="activity-event-header">
              <span className="activity-icon">{TYPE_ICONS[ev.type] ?? '\u{1F4CC}'}</span>
              <span className="activity-event-name">
                {ev.subagent ? `${ev.subagent} \u2192 ${ev.action}` : ev.type}
              </span>
              {ev.success !== null && (
                <span className={`badge ${ev.success ? 'badge-success' : 'badge-destructive'}`}>
                  {ev.success ? 'OK' : 'Echec'}
                </span>
              )}
              {ev.duration_ms !== null && (
                <span className="text-muted">{ev.duration_ms}ms</span>
              )}
              <span className="text-muted" style={{ marginLeft: 'auto' }}>{relativeTime(ev.created_at)}</span>
            </div>
            {expanded.has(ev.id) && (
              <div className="activity-event-detail">
                {ev.input && <div><strong>Input:</strong><pre>{ev.input}</pre></div>}
                {ev.output && <div><strong>Output:</strong><pre>{ev.output}</pre></div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
