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

export function TaskCard({ task }: { task: TaskInfo }) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card kanban-card${isDragging ? ' dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      <div className="kanban-card-header">
        <span className="kanban-card-title">{task.title}</span>
        <span className={PRIORITY_CLASS[task.priority] ?? 'badge badge-muted'}>
          {PRIORITY_LABEL[task.priority] ?? task.priority}
        </span>
      </div>
      <div className="kanban-card-meta">
        <span>{task.created_by || 'system'}</span>
        <span>{date}</span>
      </div>
    </div>
  );
}
