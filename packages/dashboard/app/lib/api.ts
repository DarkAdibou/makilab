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

/** Stream a chat response via SSE — yields parsed events */
export async function* sendMessageStream(
  message: string,
  channel = 'mission_control',
): AsyncGenerator<{ type: string; content?: string; name?: string; fullText?: string; message?: string; success?: boolean }> {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, channel }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          yield JSON.parse(line.slice(6));
        } catch { /* skip malformed */ }
      }
    }
  }
}

export interface TaskInfo {
  id: string;
  title: string;
  status: string;
  priority: string;
  created_by: string;
  channel: string;
  created_at: string;
  updated_at: string;
}

export async function fetchTasks(limit = 100): Promise<TaskInfo[]> {
  const res = await fetch(`${API_BASE}/tasks?limit=${limit}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createTaskApi(title: string, priority = 'medium', status = 'pending'): Promise<TaskInfo> {
  const res = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, priority, status }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateTaskApi(id: string, fields: { status?: string; title?: string; priority?: string }): Promise<TaskInfo> {
  const res = await fetch(`${API_BASE}/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface StatsInfo {
  messagesTotal: number;
  tasksActive: number;
  subagentCount: number;
  tasksDone7d: number;
}

export async function fetchStats(): Promise<StatsInfo> {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
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
