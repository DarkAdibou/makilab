// ============================================================
// Makilab Shared Types
// ============================================================

// Channels
export type Channel = 'whatsapp' | 'mission_control' | 'antigravity' | 'gmail' | 'raycast' | 'cli';

// Messages
export interface IncomingMessage {
  id: string;
  channel: Channel;
  from: string;
  text: string;
  timestamp: Date;
  attachments?: Attachment[];
}

export interface OutgoingMessage {
  channel: Channel;
  to: string;
  text: string;
}

export interface Attachment {
  type: 'audio' | 'image' | 'document';
  url: string;
  mimeType: string;
}

// Agent
export interface AgentContext {
  channel: Channel;
  from: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// Tools
export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  execute: (input: Record<string, unknown>) => Promise<string>;
}

// Subagents
export type SubAgentName =
  | 'time'
  | 'obsidian'
  | 'gmail'
  | 'web'
  | 'karakeep'
  | 'capture'
  | 'tasks'
  | 'homeassistant'
  | 'memory'
  | 'code'
  | 'indeed'
  | 'notebooklm'
  | 'calendar'
  | 'drive';

export interface SubAgentResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// Permissions — whitelist approach (denied by default)
export type PermissionLevel = 'allowed' | 'confirm' | 'denied';

export interface Permission {
  subagent: SubAgentName;
  action: string;
  level: PermissionLevel;
}

// Memory
export interface CoreFact {
  key: string;
  value: string;
  updatedAt: Date;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  channel: Channel;
  timestamp: Date;
}

// Tasks
export type TaskStatus = 'pending' | 'in_progress' | 'waiting_user' | 'done' | 'failed';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskStep {
  id: number;
  subagent: SubAgentName;
  action: string;
  input?: unknown;
  output?: unknown;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  requiresConfirmation?: boolean;
  modelUsed?: string;
  costUsd?: number;
}

export interface AgentTask {
  id: string;
  title: string;
  status: TaskStatus;
  createdBy: 'user' | 'agent' | 'cron';
  channel: Channel;
  priority: TaskPriority;
  dueAt?: Date;
  steps: TaskStep[];
  context: Record<string, unknown>;
  gitBranch?: string;
  cronId?: string;
}

// Smart Capture
export type CaptureType =
  | 'company'
  | 'contact'
  | 'url'
  | 'prompt'
  | 'snippet'
  | 'idea'
  | 'meeting_note'
  | 'task'
  | 'quote'
  | 'unknown';

export interface CaptureClassification {
  type: CaptureType;
  confidence: number; // 0-1
  destinations: string[];
  entities: Record<string, string>;
}
