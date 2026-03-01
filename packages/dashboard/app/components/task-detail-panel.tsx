'use client';
import { useState, useEffect } from 'react';
import { updateTaskApi, deleteTaskApi, fetchTags, type TaskInfo } from '../lib/api';

const TAG_COLORS = [
  '#5423e7', '#22c55e', '#f59e0b', '#ef4444',
  '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6',
];

function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]!;
}

interface Props {
  task: TaskInfo | null;
  onClose: () => void;
  onUpdated: (task: TaskInfo) => void;
  onDeleted: (id: string) => void;
}

export function TaskDetailPanel({ task, onClose, onUpdated, onDeleted }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description || '');
    setPriority(task.priority);
    setDueAt(task.due_at ?? '');
    setConfirmDelete(false);
    try { setTags(JSON.parse(task.tags || '[]')); } catch { setTags([]); }
  }, [task]);

  useEffect(() => {
    fetchTags().then(setAvailableTags).catch(() => {});
  }, []);

  if (!task) return null;

  async function save(fields: Record<string, unknown>) {
    if (!task) return;
    try {
      const updated = await updateTaskApi(task.id, fields as Parameters<typeof updateTaskApi>[1]);
      onUpdated(updated);
    } catch (err) { console.error(err); }
  }

  function addTag(t: string) {
    const trimmed = t.trim().toLowerCase();
    if (!trimmed || tags.includes(trimmed)) return;
    const newTags = [...tags, trimmed];
    setTags(newTags);
    setTagInput('');
    save({ tags: newTags });
  }

  function removeTag(t: string) {
    const newTags = tags.filter(x => x !== t);
    setTags(newTags);
    save({ tags: newTags });
  }

  async function handleDelete() {
    if (!task) return;
    try {
      await deleteTaskApi(task.id);
      onDeleted(task.id);
      onClose();
    } catch (err) { console.error(err); }
  }

  const suggestions = availableTags.filter(t => !tags.includes(t) && t.includes(tagInput.toLowerCase()));

  return (
    <div className="detail-panel-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={e => e.stopPropagation()}>
        <div className="detail-panel-header">
          <h3>Details</h3>
          <button className="btn btn-ghost" onClick={onClose}>&#x2715;</button>
        </div>

        <div className="detail-panel-body">
          <label className="detail-label">Titre</label>
          <input
            className="textarea"
            style={{ height: 'auto', padding: '8px 12px' }}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => title !== task.title && save({ title })}
          />

          <label className="detail-label">Description</label>
          <textarea
            className="textarea"
            rows={4}
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={() => description !== (task.description || '') && save({ description })}
            placeholder="Ajouter une description..."
          />

          <label className="detail-label">Priorite</label>
          <select
            className="textarea"
            style={{ height: 'auto', padding: '8px 12px' }}
            value={priority}
            onChange={e => { setPriority(e.target.value); save({ priority: e.target.value }); }}
          >
            <option value="low">Basse</option>
            <option value="medium">Moyenne</option>
            <option value="high">Haute</option>
          </select>

          <label className="detail-label">Tags</label>
          <div className="detail-tags">
            {tags.map(t => (
              <span key={t} className="tag-badge tag-removable" style={{ background: tagColor(t) }} onClick={() => removeTag(t)}>
                {t} &#x2715;
              </span>
            ))}
          </div>
          <input
            className="textarea"
            style={{ height: 'auto', padding: '8px 12px' }}
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); } }}
            placeholder="Ajouter un tag..."
          />
          {tagInput && suggestions.length > 0 && (
            <div className="tag-suggestions">
              {suggestions.slice(0, 5).map(s => (
                <button key={s} className="btn btn-ghost tag-suggestion" onClick={() => addTag(s)}>{s}</button>
              ))}
            </div>
          )}

          <label className="detail-label">Echeance</label>
          <input
            type="date"
            className="textarea"
            style={{ height: 'auto', padding: '8px 12px' }}
            value={dueAt ? dueAt.slice(0, 10) : ''}
            onChange={e => { setDueAt(e.target.value); save({ due_at: e.target.value || null }); }}
          />

          {task.cron_expression && (
            <>
              <label className="detail-label">Tache recurrente</label>
              <div className="detail-cron-section">
                <label className="detail-cron-toggle">
                  <input
                    type="checkbox"
                    checked={!!task.cron_enabled}
                    onChange={() => save({ cron_enabled: !task.cron_enabled })}
                  />
                  <span>{task.cron_enabled ? 'Activee' : 'Desactivee'}</span>
                </label>
                <div className="detail-cron-info">
                  <span className="detail-label" style={{ marginTop: 0 }}>Frequence</span>
                  <span className="detail-cron-value">{task.cron_expression}</span>
                </div>
                {task.cron_prompt && (
                  <div className="detail-cron-info">
                    <span className="detail-label" style={{ marginTop: 0 }}>Prompt</span>
                    <span className="detail-cron-value">{task.cron_prompt}</span>
                  </div>
                )}
              </div>
            </>
          )}
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
  );
}
