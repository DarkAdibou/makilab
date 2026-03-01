'use client';
import { useState, useEffect } from 'react';
import { fetchTags } from '../lib/api';

interface Props {
  onFilterChange: (filters: { search: string; tag: string; priority: string }) => void;
}

export function FilterBar({ onFilterChange }: Props) {
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [priority, setPriority] = useState('');
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  useEffect(() => {
    fetchTags().then(setAvailableTags).catch(() => {});
  }, []);

  useEffect(() => {
    onFilterChange({ search, tag, priority });
  }, [search, tag, priority]);

  return (
    <div className="filter-bar">
      <input
        type="text"
        className="textarea filter-search"
        placeholder="Rechercher..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <select className="textarea filter-select" value={tag} onChange={e => setTag(e.target.value)}>
        <option value="">Tous les tags</option>
        {availableTags.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <select className="textarea filter-select" value={priority} onChange={e => setPriority(e.target.value)}>
        <option value="">Toutes priorites</option>
        <option value="high">Haute</option>
        <option value="medium">Moyenne</option>
        <option value="low">Basse</option>
      </select>
      {(search || tag || priority) && (
        <button className="btn btn-ghost" onClick={() => { setSearch(''); setTag(''); setPriority(''); }}>
          Effacer
        </button>
      )}
    </div>
  );
}
