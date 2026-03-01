import { describe, it, expect, afterAll } from 'vitest';
import { buildServer } from '../server.ts';

describe('Fastify server', () => {
  const app = buildServer();
  afterAll(() => app.close());

  it('GET /api/health returns status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('uptime');
    expect(body).toHaveProperty('subagentCount');
  });
});
