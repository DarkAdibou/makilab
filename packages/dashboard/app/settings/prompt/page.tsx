'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchAgentPrompt, updateAgentPrompt } from '../../lib/api';

export default function PromptPage() {
  const [prompt, setPrompt] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const load = useCallback(() => {
    setLoading(true);
    fetchAgentPrompt()
      .then((p) => {
        setPrompt(p);
        setSaved(p);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    setStatus('idle');
    try {
      const updated = await updateAgentPrompt(prompt);
      setSaved(updated);
      setPrompt(updated);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setPrompt(saved);
    setStatus('idle');
  }

  const hasChanges = prompt !== saved;
  const lineCount = prompt.split('\n').length;

  if (loading) {
    return (
      <div className="prompt-page">
        <h1 className="prompt-page-title">Metaprompt agent</h1>
        <p className="text-muted">Chargement...</p>
      </div>
    );
  }

  return (
    <div className="prompt-page">
      <div className="prompt-page-header">
        <div>
          <h1 className="prompt-page-title">Metaprompt agent</h1>
          <p className="text-muted">
            Ce texte est injecte dans chaque conversation de l&apos;agent. Modifie-le pour changer son comportement, son ton, ses regles.
          </p>
        </div>
        <div className="prompt-page-actions">
          {status === 'saved' && <span className="prompt-status prompt-status-saved">Sauvegarde</span>}
          {status === 'error' && <span className="prompt-status prompt-status-error">Erreur</span>}
          <button className="btn btn-ghost" onClick={handleReset} disabled={!hasChanges || saving}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!hasChanges || saving}>
            {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
        </div>
      </div>

      <div className="prompt-editor-wrapper">
        <textarea
          className="prompt-editor"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          spellCheck={false}
          rows={Math.max(20, lineCount + 2)}
        />
      </div>

      <div className="prompt-page-footer text-muted">
        {prompt.length} caracteres &middot; {lineCount} lignes
        {hasChanges && ' · Modifications non sauvegardees'}
      </div>
    </div>
  );
}
