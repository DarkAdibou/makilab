import Fastify from 'fastify';
import { getAllSubAgents } from './subagents/registry.ts';

export function buildServer() {
  const app = Fastify({ logger: false });

  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    subagentCount: getAllSubAgents().length,
  }));

  return app;
}
