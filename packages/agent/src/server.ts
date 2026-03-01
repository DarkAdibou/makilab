import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getAllSubAgents } from './subagents/registry.ts';
import { getRecentMessages, listTasks, createTask, getTask, updateTask, deleteTask, getUniqueTags, getStats, listAgentEvents } from './memory/sqlite.ts';
import { runAgentLoop } from './agent-loop.ts';
import { runAgentLoopStreaming } from './agent-loop-stream.ts';

export async function buildServer() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    subagentCount: getAllSubAgents().length,
  }));

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

  // GET /api/tasks/tags — must be before /api/tasks to avoid :id match
  app.get('/api/tasks/tags', async () => {
    return getUniqueTags();
  });

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
  app.post<{ Body: { message: string; channel?: string } }>(
    '/api/chat',
    async (req) => {
      const { message, channel = 'mission_control' } = req.body;
      const history = getRecentMessages(channel, 20);
      const reply = await runAgentLoop(message, {
        channel: channel as 'mission_control',
        from: 'mission_control',
        history,
      });
      return { reply };
    },
  );

  // POST /api/tasks — create a task from the dashboard
  app.post<{ Body: { title: string; priority?: string; status?: string; description?: string; tags?: string[]; due_at?: string } }>(
    '/api/tasks',
    async (req, reply) => {
      const { title, priority, status, description, tags, due_at } = req.body;
      const id = createTask({
        title,
        createdBy: 'user',
        channel: 'mission_control',
        priority: priority as 'low' | 'medium' | 'high' | undefined,
        description,
        tags,
        dueAt: due_at,
      });
      if (status && status !== 'pending') {
        updateTask(id, { status });
      }
      const task = getTask(id);
      return reply.status(201).send(task);
    },
  );

  // PATCH /api/tasks/:id — update task fields
  app.patch<{ Params: { id: string }; Body: { status?: string; title?: string; priority?: string; description?: string; tags?: string[]; due_at?: string | null } }>(
    '/api/tasks/:id',
    async (req, reply) => {
      const existing = getTask(req.params.id);
      if (!existing) return reply.status(404).send({ error: 'Task not found' });
      const task = updateTask(req.params.id, req.body);
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
  app.post<{ Body: { message: string; channel?: string } }>(
    '/api/chat/stream',
    async (req, reply) => {
      const { message, channel = 'mission_control' } = req.body;

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

  return app;
}
