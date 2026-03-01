'use client';

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { fetchMessages, sendMessageStream } from '../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toolStatus, setToolStatus] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchMessages('mission_control', 50).then(setMessages).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolStatus]);

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
    setToolStatus('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      let fullContent = '';
      for await (const event of sendMessageStream(text)) {
        if (event.type === 'text') {
          fullContent += event.content ?? '';
          const captured = fullContent;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: captured };
            return updated;
          });
        } else if (event.type === 'tool_start') {
          const name = (event.name ?? '').replace('__', ' \u2192 ');
          setToolStatus(`Utilisation de ${name}...`);
        } else if (event.type === 'tool_end') {
          setToolStatus('');
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
    setToolStatus('');
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
        {toolStatus && (
          <div className="chat-tool-status">
            <span className="chat-tool-spinner" />
            {toolStatus}
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
