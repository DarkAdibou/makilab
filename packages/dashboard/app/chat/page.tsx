'use client';

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { fetchMessages, sendMessageStreamWithModel, fetchModels, fetchRoutes, updateRouteApi, ocrImage } from '../lib/api';
import type { ModelInfo } from '../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  channel?: string;
  costUsd?: number;
  model?: string;
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

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [agentStatus, setAgentStatus] = useState<'idle' | 'thinking' | 'working'>('idle');
  const [iterationCount, setIterationCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchMessages('all', 50).then(setMessages).catch(() => {});
    fetchModels().then(setModels).catch(() => {});
    fetchRoutes().then(routes => {
      const conv = routes.find(r => r.task_type === 'conversation');
      if (conv) setSelectedModel(conv.model_id);
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
    setInput('');
    setLoading(true);
    setToolCalls([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
    setAgentStatus('thinking');
    setIterationCount(0);

    try {
      let fullContent = '';
      for await (const event of sendMessageStreamWithModel(text, 'mission_control', selectedModel || undefined)) {
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
      const base64 = dataUrl.split(',')[1];
      try {
        const { text } = await ocrImage(base64, file.type || 'image/jpeg');
        if (text) {
          setInput((prev) => prev ? `${prev}\n\n[Image: ${file.name}]\n${text}` : `[Image: ${file.name}]\n${text}`);
        } else {
          setInput((prev) => prev ? `${prev}\n[Image: ${file.name} — aucun texte détecté]` : `[Image: ${file.name} — aucun texte détecté]`);
        }
      } catch {
        setInput((prev) => prev ? `${prev}\n[Erreur OCR: ${file.name}]` : `[Erreur OCR: ${file.name}]`);
      }
    };
    reader.readAsDataURL(file);
    // Reset so same file can be re-selected
    e.target.value = '';
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h1>Chat</h1>
        {models.length > 0 && (
          <div className="model-selector" style={{ marginLeft: 'auto' }}>
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
              m.content
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
