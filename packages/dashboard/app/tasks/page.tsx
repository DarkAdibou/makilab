'use client';
import { useState, useEffect } from 'react';
import { fetchTasks, type TaskInfo } from '../lib/api';
import { KanbanBoard } from '../components/kanban-board';
import { NewTaskModal } from '../components/new-task-modal';

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    fetchTasks(200).then(setTasks).catch(console.error);
  }, []);

  function handleCreated(task: TaskInfo) {
    setTasks((prev) => [task, ...prev]);
  }

  return (
    <div className="tasks-container">
      <div className="tasks-header">
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Taches</h1>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
          + Nouvelle tache
        </button>
      </div>
      <KanbanBoard tasks={tasks} onTasksChange={setTasks} onRequestAdd={() => setModalOpen(true)} />
      <NewTaskModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={handleCreated} />
    </div>
  );
}
