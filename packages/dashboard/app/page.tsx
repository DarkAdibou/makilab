'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { MessageSquare, CheckCircle, Plug, TrendingUp, Plus, ListTodo } from 'lucide-react';
import { fetchStats, fetchTasks, fetchMessages, type StatsInfo, type TaskInfo } from './lib/api';
import { CollapsibleSection } from './components/collapsible-section';

type Message = { role: 'user' | 'assistant'; content: string };

const STAT_ICONS = [MessageSquare, CheckCircle, Plug, TrendingUp];

export default function CommandCenter() {
  const [stats, setStats] = useState<StatsInfo | null>(null);
  const [activeTasks, setActiveTasks] = useState<TaskInfo[]>([]);
  const [recentMessages, setRecentMessages] = useState<Message[]>([]);

  const loadData = useCallback(() => {
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

  useEffect(() => {
    loadData();
    const onVisibility = () => { if (document.visibilityState === 'visible') loadData(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [loadData]);

  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Bonjour' : now.getHours() < 18 ? 'Bon apres-midi' : 'Bonsoir';
  const dateStr = now.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const statCards = [
    { value: stats?.messagesTotal ?? '—', label: 'Messages' },
    { value: stats?.tasksActive ?? '—', label: 'Taches actives' },
    { value: stats?.subagentCount ?? '—', label: 'Subagents' },
    { value: stats?.tasksDone7d ?? '—', label: 'Terminees 7j' },
  ];

  return (
    <div className="command-center dot-grid-bg">
      <div>
        <h1 className="command-greeting">{greeting}, Adrien</h1>
        <p className="command-date">{dateStr}</p>
      </div>

      <div className="quick-actions">
        <Link href="/chat" className="quick-action-btn">
          <MessageSquare size={14} /> Nouveau chat
        </Link>
        <Link href="/todo" className="quick-action-btn">
          <Plus size={14} /> Nouvelle tache
        </Link>
        <Link href="/connections" className="quick-action-btn">
          <Plug size={14} /> Connexions
        </Link>
        <Link href="/tasks" className="quick-action-btn">
          <ListTodo size={14} /> Taches agent
        </Link>
      </div>

      <div className="stat-grid">
        {statCards.map((s, i) => {
          const Icon = STAT_ICONS[i]!;
          return (
            <div key={s.label} className="card stat-card">
              <span className="stat-card-icon"><Icon size={24} /></span>
              <span className="stat-card-value">{s.value}</span>
              <span className="stat-card-label">{s.label}</span>
            </div>
          );
        })}
      </div>

      <div className="command-grid">
        <CollapsibleSection title="Taches en cours" count={activeTasks.length} defaultOpen>
          {activeTasks.length === 0 && <p className="text-muted">Aucune tache en cours</p>}
          {activeTasks.map((t) => (
            <div key={t.id} className="command-task-row">
              <span className={`badge ${t.status === 'in_progress' ? 'badge-primary' : 'badge-muted'}`}>
                {t.status === 'in_progress' ? 'En cours' : 'Todo'}
              </span>
              <span className="command-task-title">{t.title}</span>
            </div>
          ))}
        </CollapsibleSection>

        <CollapsibleSection title="Activite recente" count={recentMessages.length} defaultOpen>
          {recentMessages.length === 0 && <p className="text-muted">Aucun message recent</p>}
          {recentMessages.map((msg, i) => (
            <div key={i} className="command-message-row">
              <span className={`badge ${msg.role === 'user' ? 'badge-outline' : 'badge-muted'}`}>
                {msg.role === 'user' ? 'Vous' : 'Agent'}
              </span>
              <span className="command-message-text">{msg.content}</span>
            </div>
          ))}
        </CollapsibleSection>
      </div>
    </div>
  );
}
