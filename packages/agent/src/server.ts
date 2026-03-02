import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getAllSubAgents } from './subagents/registry.ts';
import { getRecentMessages, listTasks, createTask, getTask, updateTask, deleteTask, getUniqueTags, getStats, listAgentEvents, listAllAgentTasks, listTaskExecutions, getTaskExecutionStats, getTaskMonthlyCost, getRecentLlmUsage, getLlmUsageSummary, getLlmUsageHistory, getLlmModels, getLlmModelsCount, getLlmModelLastUpdate, getRouteConfig, setRouteForTaskType, getNotifications, getUnreadNotificationCount, markNotificationRead, markAllNotificationsRead, getNotificationSettings, updateNotificationSettings, getCoreMemory, setFact, deleteFact, getMemorySettings, updateMemorySettings, getMemoryRetrievals, searchMessagesFullText, countAllMessages } from './memory/sqlite.ts';
import type { MemorySettings } from './memory/sqlite.ts';
import { syncRecurringTasks, executeRecurringTask } from './tasks/cron.ts';
import { CronExpressionParser } from 'cron-parser';
import { runAgentLoop } from './agent-loop.ts';
import { runAgentLoopStreaming } from './agent-loop-stream.ts';
import { getMcpStatus } from './mcp/bridge.ts';
import { listAvailableModels } from './llm/pricing.ts';
import { refreshCatalog, scoreModelsForTask, getOptimizationSuggestions } from './llm/catalog.ts';
import { getWhatsAppStatus, sendWhatsAppMessage } from './whatsapp/gateway.ts';

export async function buildServer() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    subagentCount: getAllSubAgents().length,
  }));

  // GET /api/mcp/status — MCP servers connection status
  app.get('/api/mcp/status', async () => {
    return getMcpStatus();
  });

  // GET /api/subagents
  app.get('/api/subagents', async () => {
    return getAllSubAgents().map((s) => ({
      name: s.name,
      description: s.description,
      actions: s.actions.map((a) => ({
        name: a.name,
        description: a.description,
      })),
    }));
  });

  // GET /api/messages
  app.get<{ Querystring: { channel?: string; limit?: string } }>(
    '/api/messages',
    async (req) => {
      const channel = req.query.channel ?? 'mission_control';
      const limit = parseInt(req.query.limit ?? '50', 10);
      return getRecentMessages(channel, limit);
    },
  );

  // GET /api/tasks/tags — must be before /api/tasks/:id to avoid :id match
  app.get('/api/tasks/tags', async () => {
    return getUniqueTags();
  });

  // GET /api/tasks/recurring — list agent-managed tasks (recurring + one-shot scheduled) with stats
  app.get('/api/tasks/recurring', async () => {
    const tasks = listAllAgentTasks();
    return tasks.map((t) => {
      const stats = getTaskExecutionStats(t.id);
      const monthlyCost = getTaskMonthlyCost(t.id);
      let nextRun: string | null = null;
      if (t.cron_expression && t.cron_enabled) {
        try {
          const expr = CronExpressionParser.parse(t.cron_expression);
          nextRun = expr.next().toISOString();
        } catch { /* invalid cron */ }
      }
      return {
        ...t,
        stats: {
          totalRuns: stats.totalRuns,
          successCount: stats.successCount,
          errorCount: stats.errorCount,
          successRate: stats.totalRuns > 0 ? stats.successCount / stats.totalRuns : 0,
          totalCost: stats.totalCost,
          monthlyCost,
          avgDurationMs: stats.avgDurationMs,
          lastRun: stats.lastRun,
          nextRun,
        },
      };
    });
  });

  // GET /api/tasks/:id/executions — execution history
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/tasks/:id/executions',
    async (req, reply) => {
      const task = getTask(req.params.id);
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      const limit = parseInt(req.query.limit ?? '20', 10);
      return listTaskExecutions(req.params.id, limit);
    },
  );

  // POST /api/tasks/:id/execute — manual execution of a recurring task
  app.post<{ Params: { id: string } }>(
    '/api/tasks/:id/execute',
    async (req, reply) => {
      const task = getTask(req.params.id);
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      if (!task.cron_prompt) return reply.status(400).send({ error: 'Task has no cron_prompt' });
      const result = await executeRecurringTask(task);
      return result;
    },
  );

  // GET /api/tasks
  app.get<{ Querystring: { status?: string; limit?: string; tag?: string; priority?: string; search?: string } }>(
    '/api/tasks',
    async (req) => {
      const { status, limit: limitStr, tag, priority, search } = req.query;
      const limit = parseInt(limitStr ?? '100', 10);
      return listTasks({ status, limit, tag, priority, search });
    },
  );

  // POST /api/chat
  app.post<{ Body: { message: string; channel?: string; model?: string } }>(
    '/api/chat',
    async (req) => {
      const { message, channel = 'mission_control', model } = req.body;
      const history = getRecentMessages(channel, 20);
      const reply = await runAgentLoop(message, {
        channel: channel as 'mission_control',
        from: 'mission_control',
        history,
        model,
      });
      return { reply };
    },
  );

  // POST /api/tasks — create a task from the dashboard
  app.post<{ Body: { title: string; priority?: string; status?: string; description?: string; tags?: string[]; due_at?: string; cron_expression?: string; cron_prompt?: string } }>(
    '/api/tasks',
    async (req, reply) => {
      const { title, priority, status, description, tags, due_at, cron_expression, cron_prompt } = req.body;
      const id = createTask({
        title,
        createdBy: 'user',
        channel: 'mission_control',
        priority: priority as 'low' | 'medium' | 'high' | undefined,
        description,
        tags,
        dueAt: due_at,
        cronExpression: cron_expression,
        cronEnabled: !!cron_expression,
        cronPrompt: cron_prompt,
      });
      if (status && status !== 'pending') {
        updateTask(id, { status });
      }
      if (cron_expression) syncRecurringTasks();
      const task = getTask(id);
      return reply.status(201).send(task);
    },
  );

  // PATCH /api/tasks/:id — update task fields
  app.patch<{ Params: { id: string }; Body: { status?: string; title?: string; priority?: string; description?: string; tags?: string[]; due_at?: string | null; cron_expression?: string | null; cron_enabled?: boolean; cron_prompt?: string | null; model?: string | null; notify_channels?: string[] } }>(
    '/api/tasks/:id',
    async (req, reply) => {
      const existing = getTask(req.params.id);
      if (!existing) return reply.status(404).send({ error: 'Task not found' });
      const task = updateTask(req.params.id, req.body);
      if (req.body.cron_expression !== undefined || req.body.cron_enabled !== undefined) {
        syncRecurringTasks();
      }
      return task;
    },
  );

  // DELETE /api/tasks/:id
  app.delete<{ Params: { id: string } }>(
    '/api/tasks/:id',
    async (req, reply) => {
      const deleted = deleteTask(req.params.id);
      if (!deleted) return reply.status(404).send({ error: 'Task not found' });
      return { success: true };
    },
  );

  // GET /api/stats — dashboard statistics
  app.get('/api/stats', async () => {
    const stats = getStats();
    stats.subagentCount = getAllSubAgents().length;
    return stats;
  });

  // GET /api/activity — agent event log
  app.get<{ Querystring: { limit?: string; type?: string; channel?: string } }>(
    '/api/activity',
    async (req) => {
      const { limit: limitStr, type, channel } = req.query;
      const limit = parseInt(limitStr ?? '100', 10);
      return listAgentEvents({ type, channel, limit });
    },
  );

  // POST /api/chat/stream — SSE streaming chat
  app.post<{ Body: { message: string; channel?: string; model?: string } }>(
    '/api/chat/stream',
    async (req, reply) => {
      const { message, channel = 'mission_control', model } = req.body;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      try {
        const stream = runAgentLoopStreaming(message, {
          channel: channel as 'mission_control',
          from: 'mission_control',
          history: [],
          model,
        });

        for await (const event of stream) {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      } catch (err) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) })}\n\n`);
      }

      reply.raw.end();
    },
  );

  // GET /api/models/catalog — full catalog with filters
  app.get<{ Querystring: { tools?: string; minContext?: string; provider?: string } }>(
    '/api/models/catalog',
    async (req) => {
      const filters: { tools?: boolean; minContext?: number; provider?: string } = {};
      if (req.query.tools === 'true') filters.tools = true;
      if (req.query.minContext) filters.minContext = parseInt(req.query.minContext, 10);
      if (req.query.provider) filters.provider = req.query.provider;
      return getLlmModels(filters);
    },
  );

  // GET /api/models/routes — current routes + top 3 suggestions
  app.get('/api/models/routes', async () => {
    const routes = getRouteConfig();
    return routes.map(r => ({
      ...r,
      suggestions: scoreModelsForTask(r.task_type as import('./llm/router.ts').TaskType, 3),
    }));
  });

  // PATCH /api/models/routes/:taskType — change model for a task type
  app.patch<{ Params: { taskType: string }; Body: { model_id: string } }>(
    '/api/models/routes/:taskType',
    async (req) => {
      const { taskType } = req.params;
      const { model_id } = req.body;
      setRouteForTaskType(taskType, model_id);
      return { success: true, taskType, model_id };
    },
  );

  // POST /api/models/refresh — force catalog refresh
  app.post('/api/models/refresh', async () => {
    const count = await refreshCatalog();
    return { success: true, count };
  });

  // GET /api/models/suggestions — optimization suggestions
  app.get('/api/models/suggestions', async () => {
    return getOptimizationSuggestions();
  });

  // GET /api/models/meta — catalog metadata
  app.get('/api/models/meta', async () => {
    return {
      count: getLlmModelsCount(),
      lastUpdate: getLlmModelLastUpdate(),
    };
  });

  // GET /api/models — available LLM models
  app.get('/api/models', async () => {
    return listAvailableModels();
  });

  // GET /api/costs/summary — cost summary for a period
  app.get<{ Querystring: { period?: string } }>(
    '/api/costs/summary',
    async (req) => {
      const period = (req.query.period ?? 'month') as 'day' | 'week' | 'month' | 'year';
      return getLlmUsageSummary(period);
    },
  );

  // GET /api/costs/history — daily cost history
  app.get<{ Querystring: { days?: string } }>(
    '/api/costs/history',
    async (req) => {
      const days = parseInt(req.query.days ?? '30', 10);
      return getLlmUsageHistory(days);
    },
  );

  // GET /api/costs/recent — recent LLM usage entries
  app.get<{ Querystring: { limit?: string } }>(
    '/api/costs/recent',
    async (req) => {
      const limit = parseInt(req.query.limit ?? '50', 10);
      return getRecentLlmUsage(limit);
    },
  );

  // GET /api/whatsapp/status
  app.get('/api/whatsapp/status', async () => {
    return getWhatsAppStatus();
  });

  // POST /api/whatsapp/send
  app.post<{ Body: { text: string } }>('/api/whatsapp/send', async (req) => {
    const { text } = req.body;
    if (!text) return { error: 'text required' };
    try {
      await sendWhatsAppMessage(text);
      return { success: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // GET /api/notifications
  app.get<{ Querystring: { unread?: string; limit?: string } }>(
    '/api/notifications',
    async (req) => {
      const unreadOnly = req.query.unread === 'true';
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
      return getNotifications({ unreadOnly, limit });
    },
  );

  // GET /api/notifications/count
  app.get('/api/notifications/count', async () => {
    return { unread: getUnreadNotificationCount() };
  });

  // PATCH /api/notifications/:id
  app.patch<{ Params: { id: string }; Body: { read: boolean } }>(
    '/api/notifications/:id',
    async (req) => {
      if (req.body.read) markNotificationRead(req.params.id);
      return { success: true };
    },
  );

  // POST /api/notifications/read-all
  app.post('/api/notifications/read-all', async () => {
    markAllNotificationsRead();
    return { success: true };
  });

  // GET /api/notification-settings
  app.get('/api/notification-settings', async () => {
    return getNotificationSettings();
  });

  // PATCH /api/notification-settings/:channel
  app.patch<{ Params: { channel: string }; Body: { enabled?: boolean; types_filter?: string[] | null; quiet_hours_start?: string | null; quiet_hours_end?: string | null } }>(
    '/api/notification-settings/:channel',
    async (req) => {
      const fields: Record<string, unknown> = {};
      if (req.body.enabled !== undefined) fields.enabled = req.body.enabled ? 1 : 0;
      if (req.body.types_filter !== undefined) fields.types_filter = req.body.types_filter ? JSON.stringify(req.body.types_filter) : null;
      if (req.body.quiet_hours_start !== undefined) fields.quiet_hours_start = req.body.quiet_hours_start;
      if (req.body.quiet_hours_end !== undefined) fields.quiet_hours_end = req.body.quiet_hours_end;
      updateNotificationSettings(req.params.channel, fields);
      return { success: true };
    },
  );

  // ============================================================
  // Memory API endpoints
  // ============================================================

  // GET /api/memory/facts — list all core_memory facts
  app.get('/api/memory/facts', async () => {
    const facts = getCoreMemory();
    return Object.entries(facts).map(([key, value]) => ({ key, value }));
  });

  // POST /api/memory/facts — add or update a fact
  app.post<{ Body: { key: string; value: string } }>('/api/memory/facts', async (req) => {
    setFact(req.body.key, req.body.value);
    return { success: true };
  });

  // DELETE /api/memory/facts/:key — delete a fact
  app.delete<{ Params: { key: string } }>('/api/memory/facts/:key', async (req) => {
    deleteFact(req.params.key);
    return { success: true };
  });

  // GET /api/memory/search?q=...&mode=semantic|text&limit=20
  app.get<{ Querystring: { q: string; mode?: string; limit?: string } }>(
    '/api/memory/search',
    async (req) => {
      const query = req.query.q;
      const mode = req.query.mode ?? 'text';
      const limit = parseInt(req.query.limit ?? '20', 10);

      if (mode === 'semantic') {
        const { embedText } = await import('./memory/embeddings.ts');
        const { semanticSearch } = await import('./memory/qdrant.ts');
        const vector = await embedText(query);
        if (!vector) return [];
        const results = await semanticSearch(vector, limit);
        return results.map(r => ({
          content: (r.payload.content ?? r.payload.user_message ?? '') as string,
          channel: (r.payload.channel ?? 'unknown') as string,
          score: r.score,
          created_at: (r.payload.timestamp ?? '') as string,
          type: (r.payload.type ?? 'conversation') as string,
        }));
      } else {
        const results = searchMessagesFullText(query, limit);
        return results.map(m => ({
          content: m.content,
          channel: m.channel,
          score: null,
          created_at: m.created_at,
          type: 'message',
        }));
      }
    },
  );

  // GET /api/memory/settings — current memory settings
  app.get('/api/memory/settings', async () => {
    return getMemorySettings();
  });

  // PATCH /api/memory/settings — update memory settings (partial)
  app.patch<{ Body: Record<string, unknown> }>('/api/memory/settings', async (req) => {
    updateMemorySettings(req.body as Partial<MemorySettings>);
    return getMemorySettings();
  });

  // GET /api/memory/stats — memory system statistics
  app.get('/api/memory/stats', async () => {
    const facts = getCoreMemory();
    const factsCount = Object.keys(facts).length;
    const messagesCount = countAllMessages();

    let vectorsCount = 0;
    try {
      const { getClient } = await import('./memory/qdrant.ts') as { getClient?: () => unknown };
      if (typeof getClient === 'function') {
        const client = getClient();
        if (client && typeof (client as Record<string, unknown>).getCollection === 'function') {
          const convInfo = await (client as { getCollection: (name: string) => Promise<{ points_count: number }> }).getCollection('conversations');
          const knowInfo = await (client as { getCollection: (name: string) => Promise<{ points_count: number }> }).getCollection('knowledge');
          vectorsCount = (convInfo.points_count ?? 0) + (knowInfo.points_count ?? 0);
        }
      }
    } catch { /* Qdrant not available */ }

    return { factsCount, messagesCount, vectorsCount };
  });

  // GET /api/memory/retrievals?limit=20 — recent auto-retrieval events
  app.get<{ Querystring: { limit?: string } }>('/api/memory/retrievals', async (req) => {
    const limit = parseInt(req.query.limit ?? '20', 10);
    return getMemoryRetrievals(limit);
  });

  return app;
}
