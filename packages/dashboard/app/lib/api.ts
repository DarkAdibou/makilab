const API_BASE = '/api';

export async function fetchMessages(channel = 'mission_control', limit = 50) {
  const res = await fetch(`${API_BASE}/messages?channel=${channel}&limit=${limit}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
}

export async function sendMessage(message: string, channel = 'mission_control') {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, channel }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<{ reply: string }>;
}

export type SubAgentInfo = {
  name: string;
  description: string;
  actions: Array<{ name: string; description: string }>;
};

export async function fetchSubagents() {
  const res = await fetch(`${API_BASE}/subagents`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<SubAgentInfo[]>;
}
