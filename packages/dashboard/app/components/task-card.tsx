'use client';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskInfo } from '../lib/api';

const PRIORITY_CLASS: Record<string, string> = {
  high: 'badge badge-destructive',
  medium: 'badge badge-primary',
  low: 'badge badge-muted',
};

const PRIORITY_LABEL: Record<string, string> = {
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
};

const TAG_COLORS = [
  '#5423e7', '#22c55e', '#f59e0b', '#ef4444',
  '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6',
];

function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]!;
}

function humanCron(expr: string): string {
  const parts = expr.split(' ');
  if (parts.length !== 5) return expr;
  const [min, hour, dom, , dow] = parts;
  const dayNames: Record<string, string> = { '0': 'dimanche', '1': 'lundi', '2': 'mardi', '3': 'mercredi', '4': 'jeudi', '5': 'vendredi', '6': 'samedi', '7': 'dimanche' };
  if (dow !== '*' && dom === '*' && hour !== '*') return `${dayNames[dow!] ?? `jour ${dow}`} ${hour}h${min === '0' ? '' : min}`;
  if (dow === '*' && dom === '*' && hour !== '*') return `Tous les jours ${hour}h${min === '0' ? '' : min}`;
  if (dom !== '*' && dow === '*' && hour !== '*') return `Le ${dom} du mois ${hour}h${min === '0' ? '' : min}`;
  return expr;
}

export function TaskCard({ task, onClick }: { task: TaskInfo; onClick?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const date = new Date(task.created_at).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });

  const tags: string[] = (() => {
    try { return JSON.parse(task.tags || '[]'); } catch { return []; }
  })();

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card kanban-card${isDragging ? ' dragging' : ''}`}
      {...attributes}
      {...listeners}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
    >
      <div className="kanban-card-header">
        <span className="kanban-card-title">{task.title}</span>
        <span className={PRIORITY_CLASS[task.priority] ?? 'badge badge-muted'}>
          {PRIORITY_LABEL[task.priority] ?? task.priority}
        </span>
      </div>
      {task.description && (
        <div className="kanban-card-desc">{task.description}</div>
      )}
      {tags.length > 0 && (
        <div className="kanban-card-tags">
          {tags.map(t => (
            <span key={t} className="tag-badge" style={{ background: tagColor(t) }}>{t}</span>
          ))}
        </div>
      )}
      {task.cron_expression && (
        <div className="kanban-card-cron">
          <span className={`badge ${task.cron_enabled ? 'badge-cron' : 'badge-muted'}`}>
            {task.cron_enabled ? '\u{1F504}' : '\u{23F8}\u{FE0F}'} {humanCron(task.cron_expression)}
          </span>
        </div>
      )}
      <div className="kanban-card-meta">
        <span>{task.created_by || 'system'}</span>
        <span>
          {task.due_at
            ? `\u{1F4C5} ${new Date(task.due_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
            : date}
        </span>
      </div>
    </div>
  );
}
