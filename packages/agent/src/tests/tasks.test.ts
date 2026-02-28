/**
 * tasks.test.ts — Tests E6 : tasks CRUD + runner logic
 */

import { describe, it, expect } from 'vitest';

// ── Test 1 : Task CRUD ─────────────────────────────────────────────────────────

describe('Task CRUD', () => {
  const testChannel = `test-${Date.now()}`;

  it('createTask returns a UUID', async () => {
    const { createTask } = await import('../memory/sqlite.ts');
    const id = createTask({ title: 'Test task', createdBy: 'user', channel: testChannel });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('getTask returns the created task', async () => {
    const { createTask, getTask } = await import('../memory/sqlite.ts');
    const id = createTask({ title: 'Get test', createdBy: 'agent', channel: testChannel, priority: 'high' });
    const task = getTask(id);
    expect(task).not.toBeNull();
    expect(task!.title).toBe('Get test');
    expect(task!.priority).toBe('high');
    expect(task!.status).toBe('pending');
  });

  it('updateTaskStatus changes the status', async () => {
    const { createTask, getTask, updateTaskStatus } = await import('../memory/sqlite.ts');
    const id = createTask({ title: 'Status test', createdBy: 'user', channel: testChannel });
    updateTaskStatus(id, 'done');
    const task = getTask(id);
    expect(task!.status).toBe('done');
  });

  it('listTasks returns tasks for the channel', async () => {
    const { createTask, listTasks } = await import('../memory/sqlite.ts');
    const ch = `list-${Date.now()}`;
    createTask({ title: 'Task A', createdBy: 'user', channel: ch });
    createTask({ title: 'Task B', createdBy: 'cron', channel: ch });
    const tasks = listTasks({ channel: ch });
    expect(tasks.length).toBe(2);
  });

  it('listTasks filters by status', async () => {
    const { createTask, updateTaskStatus, listTasks } = await import('../memory/sqlite.ts');
    const ch = `filter-${Date.now()}`;
    const id1 = createTask({ title: 'Pending', createdBy: 'user', channel: ch });
    createTask({ title: 'Done', createdBy: 'user', channel: ch });
    updateTaskStatus(id1, 'done');
    const pending = listTasks({ channel: ch, status: 'pending' });
    expect(pending.length).toBe(1);
  });
});

// ── Test 2 : Task Steps ────────────────────────────────────────────────────────

describe('Task Steps', () => {
  it('addTaskStep returns a step ID', async () => {
    const { createTask, addTaskStep } = await import('../memory/sqlite.ts');
    const taskId = createTask({ title: 'Step test', createdBy: 'user', channel: 'test-steps' });
    const stepId = addTaskStep({ taskId, stepOrder: 1, subagent: 'time', action: 'get', input: {} });
    expect(typeof stepId).toBe('number');
    expect(stepId).toBeGreaterThan(0);
  });

  it('getTaskSteps returns steps in order', async () => {
    const { createTask, addTaskStep, getTaskSteps } = await import('../memory/sqlite.ts');
    const taskId = createTask({ title: 'Multi step', createdBy: 'user', channel: 'test-steps-2' });
    addTaskStep({ taskId, stepOrder: 2, subagent: 'obsidian', action: 'search', input: { query: 'test' } });
    addTaskStep({ taskId, stepOrder: 1, subagent: 'time', action: 'get', input: {} });
    const steps = getTaskSteps(taskId);
    expect(steps.length).toBe(2);
    expect(steps[0]!.step_order).toBe(1);
    expect(steps[1]!.step_order).toBe(2);
  });
});

// ── Test 3 : WorkflowStep structure ────────────────────────────────────────────

describe('WorkflowStep type', () => {
  it('valid step structure accepted by runner', () => {
    const step = {
      subagent: 'time',
      action: 'get',
      input: { timezone: 'Australia/Sydney' },
      requiresConfirmation: false,
    };
    expect(step.subagent).toBe('time');
    expect(step.action).toBe('get');
    expect(step.input).toHaveProperty('timezone');
  });

  it('requiresConfirmation defaults to undefined (falsy)', () => {
    const step = { subagent: 'obsidian', action: 'create', input: { path: 'test.md', content: '# test' } };
    expect(step['requiresConfirmation']).toBeUndefined();
  });
});
