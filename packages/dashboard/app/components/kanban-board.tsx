'use client';
import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TaskCard } from './task-card';
import { updateTaskApi, type TaskInfo } from '../lib/api';

const COLUMNS = [
  { id: 'backlog', label: 'Backlog', color: '#6c6c89' },
  { id: 'pending', label: 'Todo', color: '#ffc233' },
  { id: 'in_progress', label: 'En cours', color: '#5423e7' },
  { id: 'done', label: 'Termine', color: '#22c55e' },
] as const;

type ColumnId = (typeof COLUMNS)[number]['id'];

function Column({
  id,
  label,
  color,
  tasks,
  onAdd,
  onTaskClick,
}: {
  id: string;
  label: string;
  color: string;
  tasks: TaskInfo[];
  onAdd?: () => void;
  onTaskClick?: (task: TaskInfo) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div ref={setNodeRef} className={`kanban-column${isOver ? ' kanban-column-over' : ''}`}>
      <div className="kanban-column-header">
        <span className="kanban-column-title">
          <span className="kanban-column-dot" style={{ background: color }} />
          {label}
        </span>
        <span className="badge badge-muted">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="kanban-column-body">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={() => onTaskClick?.(task)} />
          ))}
        </div>
      </SortableContext>
      {onAdd && (
        <button className="btn kanban-add-btn" onClick={onAdd}>
          + Ajouter
        </button>
      )}
    </div>
  );
}

interface Props {
  tasks: TaskInfo[];
  onTasksChange: (tasks: TaskInfo[]) => void;
  onRequestAdd: () => void;
  onTaskClick?: (task: TaskInfo) => void;
}

export function KanbanBoard({ tasks, onTasksChange, onRequestAdd, onTaskClick }: Props) {
  const [activeTask, setActiveTask] = useState<TaskInfo | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function grouped(): Record<ColumnId, TaskInfo[]> {
    const g = new Map<string, TaskInfo[]>([
      ['backlog', []],
      ['pending', []],
      ['in_progress', []],
      ['done', []],
    ]);
    for (const t of tasks) {
      const target = g.get(t.status) ?? g.get('backlog')!;
      target.push(t);
    }
    return {
      backlog: g.get('backlog')!,
      pending: g.get('pending')!,
      in_progress: g.get('in_progress')!,
      done: g.get('done')!,
    };
  }

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    let newStatus: string | undefined;

    // Check if dropped over a column
    const columnIds = COLUMNS.map((c) => c.id);
    if (columnIds.includes(over.id as ColumnId)) {
      newStatus = over.id as string;
    } else {
      // Dropped over another task — find which column that task is in
      // Actually, we want the column the task is over
      const overTask = tasks.find((t) => t.id === over.id);
      if (overTask) {
        newStatus = overTask.status;
      }
    }

    const task = tasks.find((t) => t.id === taskId);
    if (!task || !newStatus || task.status === newStatus) return;

    // Optimistic update
    const prev = [...tasks];
    onTasksChange(tasks.map((t) => (t.id === taskId ? { ...t, status: newStatus! } : t)));

    try {
      await updateTaskApi(taskId, { status: newStatus });
    } catch {
      // Revert on error
      onTasksChange(prev);
    }
  }

  const groups = grouped();

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban-board">
        {COLUMNS.map((col) => (
          <Column
            key={col.id}
            id={col.id}
            label={col.label}
            color={col.color}
            tasks={groups[col.id]}
            onAdd={col.id === 'backlog' ? onRequestAdd : undefined}
            onTaskClick={onTaskClick}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <div className="card kanban-card dragging"><div className="kanban-card-title">{activeTask.title}</div></div> : null}
      </DragOverlay>
    </DndContext>
  );
}
