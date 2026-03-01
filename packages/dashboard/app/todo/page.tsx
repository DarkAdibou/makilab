'use client';
import { useState, useEffect } from 'react';
import { fetchTasks, type TaskInfo } from '../lib/api';
import { KanbanBoard } from '../components/kanban-board';
import { NewTaskModal } from '../components/new-task-modal';
import { FilterBar } from '../components/filter-bar';
import { TaskDetailPanel } from '../components/task-detail-panel';

export default function TodoPage() {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<TaskInfo[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskInfo | null>(null);
  const [filters, setFilters] = useState({ search: '', tag: '', priority: '' });

  useEffect(() => {
    fetchTasks(200).then(all => {
      // Exclude recurring tasks — those belong in /tasks
      setTasks(all.filter(t => !t.cron_enabled));
    }).catch(console.error);
  }, []);

  useEffect(() => {
    let result = tasks;
    if (filters.priority) result = result.filter(t => t.priority === filters.priority);
    if (filters.tag) result = result.filter(t => {
      try { return (JSON.parse(t.tags || '[]') as string[]).includes(filters.tag); } catch { return false; }
    });
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(t => t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
    }
    setFilteredTasks(result);
  }, [tasks, filters]);

  function handleCreated(task: TaskInfo) {
    if (!task.cron_enabled) setTasks(prev => [task, ...prev]);
  }

  function handleUpdated(updated: TaskInfo) {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    setSelectedTask(updated);
  }

  function handleDeleted(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  return (
    <div className="tasks-container">
      <div className="tasks-header">
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Todo</h1>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
          + Nouvelle tache
        </button>
      </div>
      <FilterBar onFilterChange={setFilters} />
      <KanbanBoard
        tasks={filteredTasks}
        onTasksChange={setTasks}
        onRequestAdd={() => setModalOpen(true)}
        onTaskClick={setSelectedTask}
      />
      <NewTaskModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={handleCreated} />
      <TaskDetailPanel
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onUpdated={handleUpdated}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
