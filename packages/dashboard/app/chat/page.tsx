'use client';

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  fetchMessages, sendMessageStreamWithModel, fetchModels, fetchRoutes, updateRouteApi, ocrImage,
  fetchSubagentHealth, toggleSubagent,
} from '../lib/api';
import type { ModelInfo, CapabilityHealth } from '../lib/api';

const DISPLAY_NAMES: Record<string, string> = {
  tasks: 'Agent Tasks',
  homeassistant: 'Home Assistant',
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
  channel?: string;
  costUsd?: number;
  model?: string;
  attachments?: Array<{ type: string; base64: string; mimeType: string }>;
}

interface ToolCall {
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  success?: boolean;
  loading: boolean;
}

function ToolCallBlock({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const displayName = call.name.replace('__', ' \u2192 ');

  return (
    <div className={`tool-call-block ${call.loading ? 'loading' : call.success ? 'success' : 'error'}`}>
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        {call.loading && <span className="chat-tool-spinner" />}
        {!call.loading && <span>{call.success ? '\u2713' : '\u2715'}</span>}
        <span className="tool-call-name">{displayName}</span>
        <span className="tool-call-expand">{expanded ? '\u25BC' : '\u25B6'}</span>
      </div>
      {expanded && (
        <div className="tool-call-detail">
          {call.args && <div><strong>Args:</strong><pre>{JSON.stringify(call.args, null, 2)}</pre></div>}
          {call.result && <div><strong>Resultat:</strong><pre>{call.result}</pre></div>}
        </div>
      )}
    </div>
  );
}

function ToolsPanel({
  health,
  toggles,
  onToggle,
  onClose,
}: {
  health: CapabilityHealth[];
  toggles: Record<string, boolean>;
  onToggle: (name: string, enabled: boolean) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute', top: '100%', right: 0, zIndex: 50,
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: '8px 0',
        minWidth: 260, boxShadow: 'var(--shadow-md)',
        marginTop: 4,
      }}
    >
      <div style={{
        padding: '6px 14px 8px', fontSize: '0.7rem', fontWeight: 600,
        letterSpacing: '0.06em', color: 'var(--muted-foreground)', textTransform: 'uppercase',
        borderBottom: '1px solid var(--border)',
      }}>
        Outils disponibles
      </div>
      {health.map((h) => {
        const enabled = toggles[h.name] ?? true;
        const color = !h.available
          ? 'var(--muted-foreground)'
          : h.mode === 'file_fallback' ? '#f59e0b' : 'var(--success, #22c55e)';
        const displayName = DISPLAY_NAMES[h.name] ?? (h.name.charAt(0).toUpperCase() + h.name.slice(1));

        return (
          <div key={h.name} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 14px', opacity: enabled ? 1 : 0.5,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: '0.8125rem', fontWeight: 500 }}>{displayName}</span>
            {h.mode && (
              <span style={{ fontSize: '0.68rem', color: 'var(--muted-foreground)' }}>{h.mode}</span>
            )}
            <button
              role="switch"
              aria-checked={enabled}
              onClick={() => onToggle(h.name, !enabled)}
              style={{
                position: 'relative', width: 28, height: 16, borderRadius: 8, border: 'none',
                cursor: 'pointer', flexShrink: 0, padding: 0,
                background: enabled ? 'var(--primary, #6366f1)' : 'var(--muted-foreground, #888)',
                transition: 'background 0.2s',
              }}
            >
              <span style={{
                position: 'absolute', top: 2, left: enabled ? 14 : 2, width: 12, height: 12,
                borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
              }} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [agentStatus, setAgentStatus] = useState<'idle' | 'thinking' | 'working'>('idle');
  const [iterationCount, setIterationCount] = useState(0);
  const [showTools, setShowTools] = useState(false);
  const [toolsHealth, setToolsHealth] = useState<CapabilityHealth[]>([]);
  const [toolToggles, setToolToggles] = useState<Record<string, boolean>>({});
  const [pendingImages, setPendingImages] = useState<Array<{ base64: string; mimeType: string }>>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchMessages('all', 50).then(msgs => setMessages(msgs.map(m => ({
      ...m,
      attachments: m.attachments,
    })))).catch(() => {});
    fetchModels().then(setModels).catch(() => {});
    fetchRoutes().then(routes => {
      const conv = routes.find(r => r.task_type === 'conversation');
      if (conv) setSelectedModel(conv.model_id);
    }).catch(() => {});
    fetchSubagentHealth().then(health => {
      const subagentHealth = health.filter(h => !h.name.startsWith('mcp:'));
      setToolsHealth(subagentHealth);
      const t: Record<string, boolean> = {};
      for (const h of subagentHealth) t[h.name] = true;
      setToolToggles(t);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolCalls]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const imagesToSend = [...pendingImages];
    setInput('');
    setPendingImages([]);
    setLoading(true);
    setToolCalls([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    setMessages(prev => [...prev, { role: 'user', content: text, attachments: imagesToSend.map(img => ({ type: 'image', base64: img.base64, mimeType: img.mimeType })) }]);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
    setAgentStatus('thinking');
    setIterationCount(0);

    try {
      let fullContent = '';
      for await (const event of sendMessageStreamWithModel(text, 'mission_control', selectedModel || undefined, imagesToSend.length ? imagesToSend : undefined)) {
        if (event.type === 'thinking') {
          setAgentStatus('thinking');
        } else if (event.type === 'iteration') {
          setAgentStatus('working');
          setIterationCount((event as Record<string, unknown>).n as number);
        } else if (event.type === 'text_delta') {
          setAgentStatus('idle');
          fullContent += event.content ?? '';
          const captured = fullContent;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: captured };
            return updated;
          });
        } else if (event.type === 'tool_start') {
          setToolCalls(prev => [...prev, {
            name: event.name ?? '',
            args: (event as Record<string, unknown>).args as Record<string, unknown> | undefined,
            loading: true,
          }]);
        } else if (event.type === 'tool_end') {
          const name = event.name ?? '';
          setToolCalls(prev => prev.map(tc =>
            tc.name === name && tc.loading
              ? { ...tc, loading: false, success: (event as Record<string, unknown>).success as boolean, result: (event as Record<string, unknown>).result as string | undefined }
              : tc
          ));
        } else if (event.type === 'cost') {
          const ev = event as Record<string, unknown>;
          const costUsd = ev.costUsd as number;
          const model = ev.model as string | undefined;
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last) updated[updated.length - 1] = { role: last.role, content: last.content, channel: last.channel, costUsd: costUsd > 0 ? costUsd : undefined, model };
            return updated;
          });
        } else if (event.type === 'error') {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: `Erreur: ${event.message}` };
            return updated;
          });
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: 'Erreur de connexion' };
        return updated;
      });
    }

    setAgentStatus('idle');
    setIterationCount(0);
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] ?? '';
      const mimeType = file.type || 'image/jpeg';
      setPendingImages(prev => [...prev, { base64, mimeType }]);
      try {
        const { text, description } = await ocrImage(base64, mimeType);
        if (text) {
          setInput((prev) => prev ? `${prev}\n\n[Image: ${description}]\n${text}` : `[Image: ${description}]\n${text}`);
        } else {
          setInput((prev) => prev ? `${prev}\n[Image: ${description}]` : `[Image: ${description}]`);
        }
      } catch {
        setInput((prev) => prev ? `${prev}\n[Erreur OCR: ${file.name}]` : `[Erreur OCR: ${file.name}]`);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleToolToggle = async (name: string, enabled: boolean) => {
    setToolToggles(prev => ({ ...prev, [name]: enabled }));
    try {
      await toggleSubagent(name, enabled);
    } catch {
      setToolToggles(prev => ({ ...prev, [name]: !enabled }));
    }
  };

  const activeToolCount = toolsHealth.filter(h => toolToggles[h.name] !== false && h.available).length;

  return (
    <div className="chat-container">
      <div className="chat-header" style={{ position: 'relative' }}>
        <h1>Chat</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {toolsHealth.length > 0 && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: '0.8125rem', padding: '4px 10px' }}
              onClick={() => setShowTools(v => !v)}
            >
              🔧 {activeToolCount} outil{activeToolCount !== 1 ? 's' : ''}
            </button>
          )}
          {models.length > 0 && (
            <div className="model-selector">
              <select value={selectedModel} onChange={e => {
                const modelId = e.target.value;
                setSelectedModel(modelId);
                if (modelId) updateRouteApi('conversation', modelId).catch(() => {});
              }}>
                {models.some(m => m.recommended) && (
                  <optgroup label="Recommandés">
                    {models.filter(m => m.recommended).map(m => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Tous les modèles">
                  {models.filter(m => !m.recommended).map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </optgroup>
                {selectedModel && !models.find(m => m.id === selectedModel) && (
                  <option value={selectedModel}>{selectedModel}</option>
                )}
              </select>
            </div>
          )}
        </div>
        {showTools && (
          <ToolsPanel
            health={toolsHealth}
            toggles={toolToggles}
            onToggle={handleToolToggle}
            onClose={() => setShowTools(false)}
          />
        )}
      </div>
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            {m.channel && m.channel !== 'mission_control' && (
              <span className="badge badge-muted" style={{ fontSize: '0.625rem', padding: '1px 5px', marginBottom: 4, display: 'inline-block' }}>
                {m.channel}
              </span>
            )}
            {m.role === 'assistant' ? (
              <>
                {m.content
                  ? <ReactMarkdown>{m.content}</ReactMarkdown>
                  : <span className="typing-dots"><span /><span /><span /></span>
                }
                {m.model && (
                  <span className="chat-cost-badge" title={m.costUsd && m.costUsd > 0 ? `Cout total : $${m.costUsd.toFixed(6)}` : 'Modèle gratuit ou non facturé'}>
                    <span className="chat-model-name">{m.model}</span>
                    {m.costUsd != null && m.costUsd > 0
                      ? ` ~$${m.costUsd < 0.01 ? m.costUsd.toFixed(4) : m.costUsd.toFixed(3)}`
                      : <span className="chat-free-badge"> Free</span>
                    }
                  </span>
                )}
              </>
            ) : (
              <>
                {m.attachments?.filter(a => a.type === 'image').map((att, i) => (
                  <img
                    key={i}
                    src={`data:${att.mimeType};base64,${att.base64}`}
                    alt="Image jointe"
                    style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, marginBottom: 4, display: 'block' }}
                  />
                ))}
                {m.content}
              </>
            )}
          </div>
        ))}
        {toolCalls.length > 0 && (
          <div className="chat-tool-calls">
            {toolCalls.map((tc, i) => (
              <ToolCallBlock key={`${tc.name}-${i}`} call={tc} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {agentStatus !== 'idle' && (
        <div className="agent-status">
          <span className="agent-status-spinner" />
          {agentStatus === 'thinking' && 'Analyse…'}
          {agentStatus === 'working' && iterationCount > 1 && `Itération ${iterationCount}…`}
          {agentStatus === 'working' && iterationCount <= 1 && 'Traitement…'}
        </div>
      )}
      {pendingImages.length > 0 && (
        <div style={{ padding: '4px 12px', display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border)' }}>
          {pendingImages.map((img, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={`data:${img.mimeType};base64,${img.base64}`}
                alt="Image en attente"
                style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }}
              />
              <button
                onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                style={{
                  position: 'absolute', top: -4, right: -4, width: 16, height: 16,
                  borderRadius: '50%', border: 'none', background: 'var(--destructive)',
                  color: '#fff', cursor: 'pointer', fontSize: '0.6rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                }}
              >✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="chat-input-area">
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
        <button
          className="btn btn-ghost"
          style={{ padding: '0 10px', fontSize: '1.1rem', flexShrink: 0 }}
          title="Joindre une image (OCR)"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
        >
          📎
        </button>
        <textarea
          ref={textareaRef}
          className="textarea chat-textarea"
          placeholder="Envoyer un message..."
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={loading}
        />
        <button className="btn btn-primary" onClick={handleSend} disabled={loading || !input.trim()}>
          Envoyer
        </button>
      </div>
    </div>
  );
}
