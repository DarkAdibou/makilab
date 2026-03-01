import Fastify from 'fastify';
import { getAllSubAgents } from './subagents/registry.ts';
import { getRecentMessages, listTasks } from './memory/sqlite.ts';
import { runAgentLoop } from './agent-loop.ts';

export function buildServer() {
  const app = Fastify({ logger: false });

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

  // GET /api/tasks
  app.get<{ Querystring: { status?: string; limit?: string } }>(
    '/api/tasks',
    async (req) => {
      const status = req.query.status;
      const limit = parseInt(req.query.limit ?? '10', 10);
      return listTasks({ status, limit });
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

  return app;
}
