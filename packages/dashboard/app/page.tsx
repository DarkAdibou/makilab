'use client';
import { useState, useEffect } from 'react';
import { fetchStats, fetchTasks, fetchMessages, type StatsInfo, type TaskInfo } from './lib/api';

type Message = { role: 'user' | 'assistant'; content: string };

export default function CommandCenter() {
  const [stats, setStats] = useState<StatsInfo | null>(null);
  const [activeTasks, setActiveTasks] = useState<TaskInfo[]>([]);
  const [recentMessages, setRecentMessages] = useState<Message[]>([]);

  useEffect(() => {
    fetchStats().then(setStats).catch(console.error);
    fetchTasks(50)
      .then((all) =>
        setActiveTasks(
          all
            .filter((t) => t.status === 'in_progress' || t.status === 'pending')
            .slice(0, 5),
        ),
      )
      .catch(console.error);
    fetchMessages('mission_control', 8).then(setRecentMessages).catch(console.error);
  }, []);

  return (
    <div className="command-center">
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Command Center</h1>

      <div className="stat-grid">
        <StatCard icon="&#x1F4AC;" value={stats?.messagesTotal ?? '—'} label="Messages" />
        <StatCard icon="&#x2705;" value={stats?.tasksActive ?? '—'} label="Taches actives" />
        <StatCard icon="&#x1F50C;" value={stats?.subagentCount ?? '—'} label="Subagents" />
        <StatCard icon="&#x1F4C8;" value={stats?.tasksDone7d ?? '—'} label="Terminees 7j" />
      </div>

      <div className="command-grid">
        <div className="card command-section">
          <h2>Taches en cours</h2>
          {activeTasks.length === 0 && <p className="text-muted">Aucune tache en cours</p>}
          {activeTasks.map((t) => (
            <div key={t.id} className="command-task-row">
              <span className={`badge ${t.status === 'in_progress' ? 'badge-primary' : 'badge-muted'}`}>
                {t.status === 'in_progress' ? 'En cours' : 'Todo'}
              </span>
              <span className="command-task-title">{t.title}</span>
            </div>
          ))}
        </div>

        <div className="card command-section">
          <h2>Activite recente</h2>
          {recentMessages.length === 0 && <p className="text-muted">Aucun message recent</p>}
          {recentMessages.map((msg, i) => (
            <div key={i} className="command-message-row">
              <span className={`badge ${msg.role === 'user' ? 'badge-outline' : 'badge-muted'}`}>
                {msg.role === 'user' ? 'Vous' : 'Agent'}
              </span>
              <span className="command-message-text">{msg.content}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: string; value: string | number; label: string }) {
  return (
    <div className="card stat-card">
      <span className="stat-card-icon" dangerouslySetInnerHTML={{ __html: icon }} />
      <span className="stat-card-value">{value}</span>
      <span className="stat-card-label">{label}</span>
    </div>
  );
}
