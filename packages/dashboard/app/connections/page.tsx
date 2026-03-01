'use client';
import { useState, useEffect } from 'react';
import { fetchSubagents, type SubAgentInfo } from '../lib/api';

export default function ConnectionsPage() {
  const [subagents, setSubagents] = useState<SubAgentInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSubagents().then(setSubagents).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="connections-container">
      <div className="connections-header">
        <h1>Connections</h1>
        <span className="badge badge-muted">{subagents.length} subagents</span>
      </div>
      {error && <p className="text-destructive">{error}</p>}
      <div className="connections-grid">
        {subagents.map((sa) => (
          <div key={sa.name} className="card connection-card">
            <div className="connection-card-header">
              <h3>{sa.name}</h3>
              <span className="badge badge-success">connected</span>
            </div>
            <p className="connection-description">{sa.description}</p>
            <div className="connection-actions">
              {sa.actions.map((a) => (
                <span key={a.name} className="badge badge-outline" title={a.description}>
                  {a.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
