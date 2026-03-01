'use client';
import { useState } from 'react';
import { createTaskApi, type TaskInfo } from '../lib/api';

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
  open: boolean;
  onClose: () => void;
  onCreated: (task: TaskInfo) => void;
}

export function NewTaskModal({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [cronExpression, setCronExpression] = useState('');
  const [cronPrompt, setCronPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  function addTag(t: string) {
    const trimmed = t.trim().toLowerCase();
    if (!trimmed || tags.includes(trimmed)) return;
    setTags(prev => [...prev, trimmed]);
    setTagInput('');
  }

  function removeTag(t: string) {
    setTags(prev => prev.filter(x => x !== t));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    try {
      const task = await createTaskApi(
        trimmed, priority, 'backlog', description, tags, dueAt || undefined,
        isRecurring ? cronExpression || undefined : undefined,
        isRecurring ? cronPrompt || undefined : undefined,
      );
      setTitle('');
      setDescription('');
      setPriority('medium');
      setTags([]);
      setTagInput('');
      setDueAt('');
      setIsRecurring(false);
      setCronExpression('');
      setCronPrompt('');
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
            <label htmlFor="task-desc">Description</label>
            <textarea
              id="task-desc"
              className="textarea"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description optionnelle..."
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
          <div className="modal-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <label>Tags</label>
            <div className="detail-tags" style={{ marginBottom: 6 }}>
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
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); } }}
              placeholder="Ajouter un tag (Entree pour valider)..."
            />
          </div>
          <div className="modal-row">
            <label htmlFor="task-due">Echeance</label>
            <input
              id="task-due"
              type="date"
              className="textarea"
              style={{ height: 'auto', padding: '8px 12px' }}
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
          <div className="modal-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <label className="detail-cron-toggle">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
              />
              <span>Tache recurrente</span>
            </label>
            {isRecurring && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <label htmlFor="cron-expr">Frequence CRON</label>
                <select
                  className="textarea"
                  style={{ height: 'auto', padding: '8px 12px' }}
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                >
                  <option value="">Choisir...</option>
                  <option value="0 7 * * *">Tous les jours 7h</option>
                  <option value="0 8 * * 1">Chaque lundi 8h</option>
                  <option value="0 9 * * 1-5">Lundi-vendredi 9h</option>
                  <option value="0 8 1 * *">1er du mois 8h</option>
                </select>
                <input
                  id="cron-expr"
                  className="textarea"
                  style={{ height: 'auto', padding: '8px 12px' }}
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder="Ou saisir: 0 8 * * 1 (lundi 8h)"
                />
                <label htmlFor="cron-prompt">Prompt</label>
                <textarea
                  id="cron-prompt"
                  className="textarea"
                  rows={2}
                  value={cronPrompt}
                  onChange={(e) => setCronPrompt(e.target.value)}
                  placeholder="Ex: Recherche les offres d'emploi dev senior TypeScript..."
                />
              </div>
            )}
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
