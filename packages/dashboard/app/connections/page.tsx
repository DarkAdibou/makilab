'use client';
import { useState, useEffect } from 'react';
import { fetchSubagents, fetchMcpStatus, type SubAgentInfo, type McpServerStatus } from '../lib/api';

export default function ConnectionsPage() {
  const [subagents, setSubagents] = useState<SubAgentInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSubagents().then(setSubagents).catch((e: Error) => setError(e.message));
    fetchMcpStatus().then(setMcpServers).catch(() => { /* MCP endpoint may not exist yet */ });
  }, []);

  return (
    <div className="connections-container">
      <div className="connections-header">
        <h1>Connections</h1>
        <span className="badge badge-muted">{subagents.length} subagents</span>
        {mcpServers.length > 0 && (
          <span className="badge badge-primary">{mcpServers.length} MCP</span>
        )}
      </div>
      {error && <p className="text-destructive">{error}</p>}

      {mcpServers.length > 0 && (
        <>
          <h2 className="connections-section-title">MCP Servers</h2>
          <div className="connections-grid">
            {mcpServers.map((mcp) => (
              <div key={mcp.server} className="card connection-card">
                <div className="connection-card-header">
                  <h3>{mcp.server}</h3>
                  <span className={`badge ${mcp.connected ? 'badge-success' : 'badge-destructive'}`}>
                    {mcp.connected ? 'connected' : 'disconnected'}
                  </span>
                </div>
                <p className="connection-description">
                  MCP server — {mcp.tools.length} tool{mcp.tools.length !== 1 ? 's' : ''}
                </p>
                <div className="connection-actions">
                  {mcp.tools.map((t) => (
                    <span key={t} className="badge badge-outline">{t.replace(/^mcp_[^_]+__/, '')}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="connections-section-title">Subagents</h2>
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
