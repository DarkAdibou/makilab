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
  description: string;
  status: string;
  priority: string;
  tags: string; // JSON array string
  created_by: string;
  channel: string;
  due_at: string | null;
  cron_expression: string | null;
  cron_enabled: number; // 0 or 1
  cron_prompt: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchTasks(limit = 100): Promise<TaskInfo[]> {
  const res = await fetch(`${API_BASE}/tasks?limit=${limit}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createTaskApi(
  title: string,
  priority = 'medium',
  status = 'pending',
  description = '',
  tags: string[] = [],
  due_at?: string,
  cron_expression?: string,
  cron_prompt?: string,
): Promise<TaskInfo> {
  const res = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, priority, status, description, tags, due_at, cron_expression, cron_prompt }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateTaskApi(
  id: string,
  fields: { status?: string; title?: string; priority?: string; description?: string; tags?: string[]; due_at?: string | null; cron_expression?: string | null; cron_enabled?: boolean; cron_prompt?: string | null; model?: string | null },
): Promise<TaskInfo> {
  const res = await fetch(`${API_BASE}/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteTaskApi(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function fetchTags(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/tasks/tags`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface AgentEvent {
  id: number;
  type: string;
  channel: string;
  subagent: string | null;
  action: string | null;
  input: string | null;
  output: string | null;
  success: number | null;
  duration_ms: number | null;
  created_at: string;
}

export async function fetchActivity(limit = 100, type?: string): Promise<AgentEvent[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (type) params.set('type', type);
  const res = await fetch(`${API_BASE}/activity?${params}`);
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

export interface McpServerStatus {
  server: string;
  connected: boolean;
  tools: string[];
}

export async function fetchMcpStatus(): Promise<McpServerStatus[]> {
  const res = await fetch(`${API_BASE}/mcp/status`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface RecurringTaskInfo extends TaskInfo {
  stats: {
    totalRuns: number;
    successCount: number;
    errorCount: number;
    successRate: number;
    totalCost: number;
    monthlyCost: number;
    avgDurationMs: number;
    lastRun: string | null;
    nextRun: string | null;
  };
}

export async function fetchRecurringTasks(): Promise<RecurringTaskInfo[]> {
  const res = await fetch(`${API_BASE}/tasks/recurring`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface TaskExecution {
  id: number;
  task_id: string;
  status: string;
  duration_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  model: string | null;
  cost_estimate: number | null;
  result_summary: string | null;
  error_message: string | null;
  created_at: string;
}

export async function fetchTaskExecutions(taskId: string, limit = 20): Promise<TaskExecution[]> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/executions?limit=${limit}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function executeTaskNow(taskId: string): Promise<{ success: boolean; durationMs: number; error?: string }> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/execute`, { method: 'POST' });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── LLM Cost Tracking ───────────────────────────────────────────────────

export interface CostSummary {
  totalCost: number;
  totalCalls: number;
  totalTokensIn: number;
  totalTokensOut: number;
  byModel: Array<{ model: string; cost: number; calls: number }>;
  byTaskType: Array<{ taskType: string; cost: number; calls: number }>;
}

export interface CostHistoryPoint {
  date: string;
  cost: number;
  calls: number;
}

export interface LlmUsageEntry {
  id: number;
  provider: string;
  model: string;
  task_type: string;
  channel: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  duration_ms: number | null;
  task_id: string | null;
  created_at: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
}

export async function fetchCostSummary(period: 'day' | 'week' | 'month' | 'year' = 'month'): Promise<CostSummary> {
  const res = await fetch(`${API_BASE}/costs/summary?period=${period}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchCostHistory(days = 30): Promise<CostHistoryPoint[]> {
  const res = await fetch(`${API_BASE}/costs/history?days=${days}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchRecentUsage(limit = 50): Promise<LlmUsageEntry[]> {
  const res = await fetch(`${API_BASE}/costs/recent?limit=${limit}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${API_BASE}/models`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function* sendMessageStreamWithModel(
  message: string,
  channel = 'mission_control',
  model?: string,
): AsyncGenerator<{ type: string; content?: string; name?: string; fullText?: string; message?: string; success?: boolean }> {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, channel, model }),
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

// ── Notifications ────────────────────────────────────────────────────

export interface NotificationInfo {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  link: string | null;
  read: number;
  created_at: string;
}

export async function fetchNotifications(unread = false, limit = 20): Promise<NotificationInfo[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (unread) params.set('unread', 'true');
  const res = await fetch(`${API_BASE}/notifications?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await fetch(`${API_BASE}/notifications/count`);
  if (!res.ok) return 0;
  const data = await res.json() as { unread: number };
  return data.unread;
}

export async function markNotificationReadApi(id: string): Promise<void> {
  await fetch(`${API_BASE}/notifications/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ read: true }),
  });
}

export async function markAllNotificationsReadApi(): Promise<void> {
  await fetch(`${API_BASE}/notifications/read-all`, { method: 'POST' });
}

// ── Catalog & Routes ─────────────────────────────────────────────────

export interface CatalogModel {
  id: string;
  name: string;
  provider_slug: string;
  context_length: number;
  price_input_per_m: number;
  price_output_per_m: number;
  supports_tools: number;
  supports_reasoning: number;
  modality: string;
}

export interface RouteWithSuggestions {
  task_type: string;
  model_id: string;
  suggestions: Array<{ modelId: string; name: string; score: number; priceInput: number; priceOutput: number }>;
}

export interface OptimizationSuggestion {
  taskType: string;
  currentModel: string;
  currentPriceIn: number;
  currentPriceOut: number;
  suggestedModel: string;
  suggestedName: string;
  suggestedPriceIn: number;
  suggestedPriceOut: number;
  savingsPercent: number;
}

export async function fetchCatalog(filters?: Record<string, string>): Promise<CatalogModel[]> {
  const params = new URLSearchParams(filters);
  const res = await fetch(`${API_BASE}/models/catalog?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchRoutes(): Promise<RouteWithSuggestions[]> {
  const res = await fetch(`${API_BASE}/models/routes`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateRouteApi(taskType: string, modelId: string): Promise<void> {
  await fetch(`${API_BASE}/models/routes/${taskType}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: modelId }),
  });
}

export async function refreshCatalogApi(): Promise<{ count: number }> {
  const res = await fetch(`${API_BASE}/models/refresh`, { method: 'POST' });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchSuggestions(): Promise<OptimizationSuggestion[]> {
  const res = await fetch(`${API_BASE}/models/suggestions`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchCatalogMeta(): Promise<{ count: number; lastUpdate: string | null }> {
  const res = await fetch(`${API_BASE}/models/meta`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── Memory ────────────────────────────────────────────────────────────

export interface FactInfo {
  key: string;
  value: string;
}

export interface MemorySettingsInfo {
  auto_retrieve_enabled: boolean;
  auto_retrieve_max_results: number;
  auto_retrieve_min_score: number;
  obsidian_context_enabled: boolean;
  obsidian_context_notes: string[];
  obsidian_context_tag: string;
}

export interface MemorySearchResult {
  content: string;
  channel: string;
  score: number | null;
  created_at: string;
  type: string;
}

export interface MemoryRetrievalInfo {
  id: string;
  channel: string;
  user_message_preview: string;
  memories_injected: number;
  obsidian_notes_injected: number;
  total_tokens_added: number;
  created_at: string;
}

export interface MemoryStats {
  factsCount: number;
  messagesCount: number;
  vectorsCount: number;
}

export async function fetchFacts(): Promise<FactInfo[]> {
  const res = await fetch(`${API_BASE}/memory/facts`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function addFactApi(key: string, value: string): Promise<void> {
  const res = await fetch(`${API_BASE}/memory/facts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function deleteFactApi(key: string): Promise<void> {
  const res = await fetch(`${API_BASE}/memory/facts/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function fetchMemorySettings(): Promise<MemorySettingsInfo> {
  const res = await fetch(`${API_BASE}/memory/settings`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateMemorySettingsApi(updates: Partial<MemorySettingsInfo>): Promise<MemorySettingsInfo> {
  const res = await fetch(`${API_BASE}/memory/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function searchMemory(query: string, mode: 'semantic' | 'text', limit?: number): Promise<MemorySearchResult[]> {
  const params = new URLSearchParams({ q: query, mode });
  if (limit) params.set('limit', String(limit));
  const res = await fetch(`${API_BASE}/memory/search?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchMemoryStats(): Promise<MemoryStats> {
  const res = await fetch(`${API_BASE}/memory/stats`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchMemoryRetrievals(limit?: number): Promise<MemoryRetrievalInfo[]> {
  const params = limit ? `?limit=${limit}` : '';
  const res = await fetch(`${API_BASE}/memory/retrievals${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── Notification Settings ────────────────────────────────────────────

export interface NotificationSettingInfo {
  channel: string;
  enabled: number;
  types_filter: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

export async function fetchNotificationSettings(): Promise<NotificationSettingInfo[]> {
  const res = await fetch(`${API_BASE}/notification-settings`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateNotificationSettingsApi(channel: string, fields: Partial<NotificationSettingInfo>): Promise<void> {
  await fetch(`${API_BASE}/notification-settings/${channel}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
}
