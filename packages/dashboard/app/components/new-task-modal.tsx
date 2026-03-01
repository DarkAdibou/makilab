'use client';
import { useState } from 'react';
import { createTaskApi, type TaskInfo } from '../lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (task: TaskInfo) => void;
}

export function NewTaskModal({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    try {
      const task = await createTaskApi(trimmed, priority, 'backlog');
      setTitle('');
      setPriority('medium');
      onCreated(task);
      onClose();
    } catch (err) {
      console.error('Failed to create task', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Nouvelle tache</h3>
        <form onSubmit={handleSubmit}>
          <div className="modal-row">
            <label htmlFor="task-title">Titre</label>
            <input
              id="task-title"
              className="textarea"
              style={{ height: 'auto', padding: '8px 12px' }}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Titre de la tache..."
              autoFocus
            />
          </div>
          <div className="modal-row">
            <label htmlFor="task-priority">Priorite</label>
            <select
              id="task-priority"
              className="textarea"
              style={{ height: 'auto', padding: '8px 12px' }}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="low">Basse</option>
              <option value="medium">Moyenne</option>
              <option value="high">Haute</option>
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || !title.trim()}>
              {loading ? 'Creation...' : 'Creer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
