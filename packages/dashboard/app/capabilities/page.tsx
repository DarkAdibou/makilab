'use client';
import { useState, useEffect } from 'react';
import {
  fetchSubagents, fetchMcpStatus, fetchSubagentHealth, toggleSubagent, fetchSkills, toggleSkill,
  type SubAgentInfo, type McpServerStatus, type CapabilityHealth, type SkillInfo,
} from '../lib/api';

const ICONS: Record<string, string> = {
  time: '🕐', web: '🌐', karakeep: '🔖', obsidian: '🗒️',
  capture: '📥', tasks: '✅', homeassistant: '🏠', memory: '🧠',
  code: '💻', settings: '⚙️', whatsapp: '📱',
};

const DISPLAY_NAMES: Record<string, string> = {
  tasks: 'Agent Tasks',
  homeassistant: 'Home Assistant',
};

function statusColor(h: CapabilityHealth, enabled: boolean): string {
  if (!enabled) return 'var(--muted-foreground)';
  if (!h.available) return h.reason?.includes('configuré') ? 'var(--muted-foreground)' : 'var(--destructive)';
  return h.mode === 'file_fallback' ? '#f59e0b' : 'var(--success, #22c55e)';
}

function StatusBadge({ h, enabled }: { h: CapabilityHealth; enabled: boolean }) {
  const color = statusColor(h, enabled);
  const label = !enabled
    ? 'Désactivé'
    : !h.available
    ? (h.reason?.includes('configuré') ? 'Non configuré' : 'Hors ligne')
    : h.mode === 'file_fallback' ? 'Fallback' : 'Actif';

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: '0.7rem', fontWeight: 500, color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={(e) => { e.stopPropagation(); onChange(!enabled); }}
      style={{
        position: 'relative', width: 32, height: 18, borderRadius: 9, border: 'none',
        cursor: 'pointer', flexShrink: 0, padding: 0,
        background: enabled ? 'var(--primary, #6366f1)' : 'var(--muted-foreground, #888)',
        transition: 'background 0.2s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: enabled ? 16 : 2, width: 14, height: 14,
        borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
      }} />
    </button>
  );
}

const SECTION_HEADER_STYLE = {
  fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em',
  color: 'var(--muted-foreground)', textTransform: 'uppercase' as const, marginBottom: 12,
};

export default function CapabilitiesPage() {
  const [subagents, setSubagents] = useState<SubAgentInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [healthData, setHealthData] = useState<CapabilityHealth[]>([]);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sas, mcps, health, skillList] = await Promise.all([
        fetchSubagents(),
        fetchMcpStatus().catch(() => [] as McpServerStatus[]),
        fetchSubagentHealth().catch(() => [] as CapabilityHealth[]),
        fetchSkills().catch(() => [] as SkillInfo[]),
      ]);
      setSubagents(sas);
      setMcpServers(mcps);
      setHealthData(health);
      setSkills(skillList);
      const enabledNames = new Set(sas.map((s) => s.name));
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
      setToggles((prev) => ({ ...prev, [name]: !enabled }));
    }
  };

  const handleSkillToggle = async (name: string, enabled: boolean) => {
    setSkills((prev) => prev.map((s) => s.name === name ? { ...s, enabled } : s));
    try {
      await toggleSkill(name, enabled);
    } catch {
      setSkills((prev) => prev.map((s) => s.name === name ? { ...s, enabled: !enabled } : s));
    }
  };

  const allCapabilities = healthData.filter((h) => !h.name.startsWith('mcp:'));
  const connectedCount = allCapabilities.filter((h) => h.available).length;
  const progressPct = allCapabilities.length > 0 ? (connectedCount / allCapabilities.length) * 100 : 0;
  const saActionMap = Object.fromEntries(subagents.map((s) => [s.name, s.actions]));

  const renderSubagentCard = (h: CapabilityHealth) => {
    const enabled = toggles[h.name] ?? true;
    const notConfigured = !h.available && h.reason?.includes('configuré');
    const isHovered = hoveredCard === h.name;
    const actions = saActionMap[h.name] ?? [];
    const isExpanded = expanded[h.name];
    const displayName = DISPLAY_NAMES[h.name] ?? (h.name.charAt(0).toUpperCase() + h.name.slice(1));
    const icon = ICONS[h.name] ?? '🔧';

    return (
      <div
        key={h.name}
        onMouseEnter={() => setHoveredCard(h.name)}
        onMouseLeave={() => setHoveredCard(null)}
        style={{
          position: 'relative',
          background: notConfigured ? 'transparent' : 'var(--card)',
          border: notConfigured
            ? '2px dashed var(--border)'
            : `1px solid ${isHovered && enabled ? 'var(--primary)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-lg)',
          padding: '14px 14px 10px',
          opacity: enabled ? 1 : 0.45,
          transition: 'border-color 0.15s, opacity 0.2s',
        }}
      >
        {isHovered && enabled && !notConfigured && (
          <button
            onClick={() => handleToggle(h.name, false)}
            title="Désactiver"
            style={{
              position: 'absolute', top: 6, right: 6,
              width: 18, height: 18, borderRadius: '50%',
              border: 'none', background: 'var(--muted)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.6rem', color: 'var(--muted-foreground)', padding: 0,
            }}
          >
            ✕
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>{icon}</span>
          <span style={{ fontWeight: 600, fontSize: '0.8125rem', fontStyle: !enabled ? 'italic' : 'normal' }}>
            {displayName}
          </span>
        </div>
        <StatusBadge h={h} enabled={enabled} />
        {(h.mode || h.reason) && (
          <div style={{
            fontSize: '0.68rem', color: 'var(--muted-foreground)', marginTop: 2,
            lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {h.available ? h.mode : h.reason}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          {actions.length > 0 ? (
            <button
              onClick={() => setExpanded((prev) => ({ ...prev, [h.name]: !prev[h.name] }))}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontSize: '0.68rem', color: 'var(--muted-foreground)',
              }}
            >
              {isExpanded ? '▲' : '▼'} {actions.length} action{actions.length > 1 ? 's' : ''}
            </button>
          ) : <span />}
          <ToggleSwitch enabled={enabled} onChange={(v) => handleToggle(h.name, v)} />
        </div>
        {isExpanded && actions.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {actions.map((a) => (
              <span key={a.name} className="badge badge-outline" style={{ fontSize: '0.65rem' }} title={a.description}>
                {a.name}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderSkillCard = (skill: SkillInfo) => {
    const isHovered = hoveredCard === `skill:${skill.name}`;
    const shortDesc = skill.description.length > 80
      ? skill.description.slice(0, 80) + '…'
      : skill.description;

    return (
      <div
        key={skill.name}
        onMouseEnter={() => setHoveredCard(`skill:${skill.name}`)}
        onMouseLeave={() => setHoveredCard(null)}
        style={{
          position: 'relative',
          background: 'var(--card)',
          border: `1px solid ${isHovered && skill.enabled ? 'var(--primary)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-lg)',
          padding: '14px 14px 10px',
          opacity: skill.enabled ? 1 : 0.45,
          transition: 'border-color 0.15s, opacity 0.2s',
        }}
      >
        {isHovered && skill.enabled && (
          <button
            onClick={() => handleSkillToggle(skill.name, false)}
            title="Désactiver"
            style={{
              position: 'absolute', top: 6, right: 6,
              width: 18, height: 18, borderRadius: '50%',
              border: 'none', background: 'var(--muted)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.6rem', color: 'var(--muted-foreground)', padding: 0,
            }}
          >
            ✕
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>📖</span>
          <span style={{ fontWeight: 600, fontSize: '0.8125rem', fontStyle: !skill.enabled ? 'italic' : 'normal' }}>
            {skill.name}
          </span>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: '0.7rem', fontWeight: 500,
          color: skill.enabled ? 'var(--success, #22c55e)' : 'var(--muted-foreground)',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: skill.enabled ? 'var(--success, #22c55e)' : 'var(--muted-foreground)',
          }} />
          {skill.enabled ? 'Actif' : 'Désactivé'}
        </span>
        <div style={{
          fontSize: '0.68rem', color: 'var(--muted-foreground)', marginTop: 2,
          lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {shortDesc}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 10 }}>
          <ToggleSwitch enabled={skill.enabled} onChange={(v) => handleSkillToggle(skill.name, v)} />
        </div>
      </div>
    );
  };

  return (
    <div className="connections-container">
      <div className="connections-header">
        <h1>Capabilities</h1>
        <button
          className="btn btn-ghost"
          style={{ padding: '6px 14px', fontSize: '0.8125rem' }}
          onClick={loadData}
          disabled={loading}
        >
          {loading ? 'Chargement...' : 'Rafraîchir'}
        </button>
      </div>

      {error && <p className="text-destructive">{error}</p>}

      {allCapabilities.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--muted)', overflow: 'hidden', marginBottom: 6 }}>
            <div style={{
              height: '100%', width: `${progressPct}%`,
              background: 'linear-gradient(90deg, var(--primary), #7c3aed)',
              borderRadius: 3, transition: 'width 0.4s ease',
            }} />
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
            {connectedCount} / {allCapabilities.length} subagents connectés
          </span>
        </div>
      )}

      {/* Subagents */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={SECTION_HEADER_STYLE}>Subagents</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {allCapabilities.map(renderSubagentCard)}
        </div>
        {allCapabilities.length === 0 && !loading && (
          <p className="text-muted">Aucun subagent disponible</p>
        )}
      </div>

      {/* Skills */}
      {skills.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={SECTION_HEADER_STYLE}>Skills</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {skills.map(renderSkillCard)}
          </div>
        </div>
      )}

      {/* MCP servers */}
      {mcpServers.length > 0 && (
        <div>
          <h2 style={SECTION_HEADER_STYLE}>MCP Servers</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {mcpServers.map((mcp) => (
              <div key={mcp.server}>
                <div
                  style={{
                    background: 'var(--card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-lg)', padding: '14px 14px 10px', cursor: 'pointer',
                  }}
                  onClick={() => setExpanded((prev) => ({ ...prev, [`mcp:${mcp.server}`]: !prev[`mcp:${mcp.server}`] }))}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>🔌</span>
                    <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{mcp.server}</span>
                  </div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: '0.7rem', fontWeight: 500,
                    color: mcp.connected ? 'var(--success, #22c55e)' : 'var(--destructive)',
                  }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      background: mcp.connected ? 'var(--success, #22c55e)' : 'var(--destructive)',
                    }} />
                    {mcp.connected ? `${mcp.tools.length} outil${mcp.tools.length !== 1 ? 's' : ''}` : 'Déconnecté'}
                  </span>
                  <div style={{ textAlign: 'right', marginTop: 8 }}>
                    <span style={{ fontSize: '0.68rem', color: 'var(--muted-foreground)' }}>
                      {expanded[`mcp:${mcp.server}`] ? '▲' : '▼'}
                    </span>
                  </div>
                </div>
                {expanded[`mcp:${mcp.server}`] && mcp.tools.length > 0 && (
                  <div style={{ padding: '8px 4px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {mcp.tools.map((t) => (
                      <span key={t} className="badge badge-outline" style={{ fontSize: '0.65rem' }}>
                        {t.replace(/^mcp_[^_]+__/, '')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
