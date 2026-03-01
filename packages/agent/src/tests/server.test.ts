import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.ts';

describe('Fastify server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

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

  it('POST /api/tasks creates a task and returns it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { title: 'Test task', priority: 'high' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe('Test task');
    expect(body.status).toBe('pending');
    expect(body.priority).toBe('high');
  });

  it('PATCH /api/tasks/:id updates task status', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { title: 'To update' },
    });
    const { id } = createRes.json();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      payload: { status: 'in_progress' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('in_progress');
  });

  it('GET /api/stats returns dashboard statistics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('messagesTotal');
    expect(body).toHaveProperty('tasksActive');
    expect(body).toHaveProperty('subagentCount');
    expect(body).toHaveProperty('tasksDone7d');
  });
});
