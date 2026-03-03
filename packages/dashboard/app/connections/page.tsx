'use client';
import { useState, useEffect } from 'react';
import {
  fetchSubagents, fetchMcpStatus, fetchSubagentHealth, toggleSubagent,
  type SubAgentInfo, type McpServerStatus, type CapabilityHealth,
} from '../lib/api';

// Map subagent names to their CapabilityHealth entry
function getHealth(healthData: CapabilityHealth[], name: string): CapabilityHealth | undefined {
  return healthData.find((h) => h.name === name);
}

function StatusDot({ health }: { health?: CapabilityHealth }) {
  if (!health) return <span style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', background: 'var(--muted)', flexShrink: 0 }} />;
  if (!health.available) {
    const isOffline = health.reason && !health.reason.includes('configuré');
    const color = isOffline ? 'var(--destructive)' : 'var(--muted)';
    return <span style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', background: color, flexShrink: 0 }} title={health.reason} />;
  }
  const color = health.mode === 'file_fallback' ? '#f59e0b' : 'var(--success, #22c55e)';
  return <span style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', background: color, flexShrink: 0 }} title={health.mode} />;
}

function ToggleSwitch({ enabled, onChange, disabled }: { enabled: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      style={{
        position: 'relative', width: 36, height: 20, borderRadius: 10, border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: enabled ? 'var(--primary, #6366f1)' : 'var(--muted-foreground, #888)',
        transition: 'background 0.2s', flexShrink: 0, padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: enabled ? 18 : 3, width: 14, height: 14,
        borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
      }} />
    </button>
  );
}

export default function ConnectionsPage() {
  const [subagents, setSubagents] = useState<SubAgentInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [healthData, setHealthData] = useState<CapabilityHealth[]>([]);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sas, mcps, health] = await Promise.all([
        fetchSubagents(),
        fetchMcpStatus().catch(() => [] as McpServerStatus[]),
        fetchSubagentHealth().catch(() => [] as CapabilityHealth[]),
      ]);
      setSubagents(sas);
      setMcpServers(mcps);
      setHealthData(health);
      // Init toggles: enabled = not disabled = available in the subagents list
      const enabledNames = new Set(sas.map((s) => s.name));
      // We need to fetch all possible subagents — use health names for full list
      const allNames = health.filter((h) => !h.name.startsWith('mcp:')).map((h) => h.name);
      const t: Record<string, boolean> = {};
      for (const name of allNames) t[name] = enabledNames.has(name);
      setToggles(t);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleToggle = async (name: string, enabled: boolean) => {
    setToggles((prev) => ({ ...prev, [name]: enabled }));
    try {
      await toggleSubagent(name, enabled);
    } catch {
      // Revert on error
      setToggles((prev) => ({ ...prev, [name]: !enabled }));
    }
  };

  const toggleExpand = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  // Split subagents from health into groups
  const allCapabilities = healthData.filter((h) => !h.name.startsWith('mcp:'));
  const configured = allCapabilities.filter((h) => h.available || (h.reason && !h.reason.includes('configuré')));
  const notConfigured = allCapabilities.filter((h) => !h.available && h.reason && h.reason.includes('configuré'));

  const saActionMap = Object.fromEntries(subagents.map((s) => [s.name, s.actions]));

  const renderSubagentRow = (h: CapabilityHealth) => {
    const enabled = toggles[h.name] ?? true;
    const actions = saActionMap[h.name] ?? [];
    const isExpanded = expanded[h.name];

    return (
      <div
        key={h.name}
        style={{
          opacity: enabled ? 1 : 0.45,
          padding: '10px 0',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => toggleExpand(h.name)}>
          <StatusDot health={h} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 500, fontStyle: enabled ? 'normal' : 'italic' }}>{h.name}</span>
            {h.mode && <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>{h.mode}</span>}
            {!h.available && h.reason && <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>{h.reason}</span>}
          </div>
          {actions.length > 0 && (
            <span style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)', marginRight: 4 }}>
              {isExpanded ? '▲' : '▼'} {actions.length} action{actions.length > 1 ? 's' : ''}
            </span>
          )}
          <ToggleSwitch
            enabled={enabled}
            onChange={(v) => { handleToggle(h.name, v); }}
          />
        </div>
        {isExpanded && actions.length > 0 && (
          <div style={{ marginTop: 8, marginLeft: 20, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {actions.map((a) => (
              <span key={a.name} className="badge badge-outline" title={a.description}>{a.name}</span>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="connections-container">
      <div className="connections-header">
        <h1>Connections</h1>
        <button className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: '0.8125rem' }} onClick={loadData} disabled={loading}>
          {loading ? 'Chargement...' : 'Rafraîchir'}
        </button>
      </div>

      {error && <p className="text-destructive">{error}</p>}

      <div className="card" style={{ padding: '0 16px', marginBottom: 24 }}>
        <h2 style={{ margin: '12px 0 0', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>
          Subagents
        </h2>

        {configured.length > 0 && (
          configured.map(renderSubagentRow)
        )}

        {notConfigured.length > 0 && (
          <>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', margin: '16px 0 4px', fontWeight: 600 }}>Non configurés</p>
            {notConfigured.map(renderSubagentRow)}
          </>
        )}

        {allCapabilities.length === 0 && !loading && (
          <p className="text-muted" style={{ padding: '12px 0' }}>Aucun subagent disponible</p>
        )}
      </div>

      {mcpServers.length > 0 && (
        <div className="card" style={{ padding: '0 16px' }}>
          <h2 style={{ margin: '12px 0 0', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>
            MCP Servers
          </h2>
          {mcpServers.map((mcp) => (
            <div
              key={mcp.server}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
              onClick={() => toggleExpand(`mcp:${mcp.server}`)}
            >
              <span style={{
                width: 10, height: 10, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
                background: mcp.connected ? 'var(--success, #22c55e)' : 'var(--destructive)',
              }} />
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 500 }}>{mcp.server}</span>
                <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
                  {mcp.connected ? `${mcp.tools.length} outil${mcp.tools.length !== 1 ? 's' : ''}` : 'déconnecté'}
                </span>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)' }}>
                {expanded[`mcp:${mcp.server}`] ? '▲' : '▼'}
              </span>
            </div>
          ))}
          {mcpServers.map((mcp) => expanded[`mcp:${mcp.server}`] && mcp.tools.length > 0 && (
            <div key={`${mcp.server}-tools`} style={{ padding: '8px 0 12px 20px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {mcp.tools.map((t) => (
                <span key={t} className="badge badge-outline">{t.replace(/^mcp_[^_]+__/, '')}</span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
