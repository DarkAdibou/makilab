'use client';

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { fetchMessages, sendMessageStreamWithModel, fetchModels } from '../lib/api';
import type { ModelInfo } from '../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchMessages('mission_control', 50).then(setMessages).catch(() => {});
    fetchModels().then(setModels).catch(() => {});
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

    try {
      let fullContent = '';
      for await (const event of sendMessageStreamWithModel(text, 'mission_control', selectedModel || undefined)) {
        if (event.type === 'text_delta') {
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

    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h1>Chat</h1>
        <span className="badge badge-muted">mission_control</span>
        {models.length > 0 && (
          <div className="model-selector" style={{ marginLeft: 'auto' }}>
            <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
              <option value="">Auto (defaut)</option>
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            {m.role === 'assistant' ? (
              <ReactMarkdown>{m.content || '...'}</ReactMarkdown>
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
      <div className="chat-input-area">
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
