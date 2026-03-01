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

  it('GET /api/subagents returns array of subagents', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/subagents' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(7);
    expect(body[0]).toHaveProperty('name');
    expect(body[0]).toHaveProperty('description');
    expect(body[0]).toHaveProperty('actions');
  });

  it('GET /api/messages returns array', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/messages?channel=mission_control&limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/tasks returns array', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks?limit=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
