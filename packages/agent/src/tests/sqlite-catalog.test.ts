import { describe, it, expect } from 'vitest';
import {
  upsertLlmModel, getLlmModels, getLlmModel, getLlmModelsCount,
  getRouteConfig, getRouteForTaskType, setRouteForTaskType,
  createNotification, getNotifications, getUnreadNotificationCount, markNotificationRead, markAllNotificationsRead,
  getNotificationSettings, updateNotificationSettings,
} from '../memory/sqlite.ts';

describe('LLM Models catalog', () => {
  it('upsert + get model', () => {
    upsertLlmModel({
      id: 'test/model-1', name: 'Test Model', provider_slug: 'test',
      context_length: 128000, price_input_per_m: 1.0, price_output_per_m: 2.0,
      supports_tools: 1, supports_reasoning: 0, modality: 'text->text', updated_at: '',
    });
    const m = getLlmModel('test/model-1');
    expect(m).not.toBeNull();
    expect(m!.name).toBe('Test Model');
    expect(m!.price_input_per_m).toBe(1.0);
  });

  it('filters by tools', () => {
    upsertLlmModel({
      id: 'test/no-tools', name: 'No Tools', provider_slug: 'test',
      context_length: 32000, price_input_per_m: 0.5, price_output_per_m: 1.0,
      supports_tools: 0, supports_reasoning: 0, modality: 'text->text', updated_at: '',
    });
    const withTools = getLlmModels({ tools: true });
    expect(withTools.every(m => m.supports_tools === 1)).toBe(true);
  });

  it('counts models', () => {
    expect(getLlmModelsCount()).toBeGreaterThanOrEqual(2);
  });
});

describe('Route config', () => {
  it('has default routes', () => {
    const routes = getRouteConfig();
    expect(routes.length).toBeGreaterThanOrEqual(6);
  });

  it('get/set route', () => {
    setRouteForTaskType('conversation', 'test/model-1');
    expect(getRouteForTaskType('conversation')).toBe('test/model-1');
    // Restore
    setRouteForTaskType('conversation', 'claude-sonnet-4-6');
  });
});

describe('Notifications', () => {
  it('create + list', () => {
    const id = createNotification({ type: 'test', severity: 'info', title: 'Test', body: 'Test body' });
    const all = getNotifications();
    expect(all.some(n => n.id === id)).toBe(true);
  });

  it('unread count + mark read', () => {
    const id = createNotification({ type: 'test', severity: 'info', title: 'Unread', body: 'Body' });
    const before = getUnreadNotificationCount();
    expect(before).toBeGreaterThanOrEqual(1);
    markNotificationRead(id);
    const after = getUnreadNotificationCount();
    expect(after).toBe(before - 1);
  });

  it('mark all read', () => {
    createNotification({ type: 'test', severity: 'info', title: 'A', body: 'B' });
    markAllNotificationsRead();
    expect(getUnreadNotificationCount()).toBe(0);
  });
});

describe('Notification settings', () => {
  it('has default settings', () => {
    const settings = getNotificationSettings();
    expect(settings.length).toBeGreaterThanOrEqual(3);
    const mc = settings.find(s => s.channel === 'mission_control');
    expect(mc?.enabled).toBe(1);
  });

  it('update settings', () => {
    updateNotificationSettings('whatsapp', { enabled: 0 });
    const settings = getNotificationSettings();
    const wa = settings.find(s => s.channel === 'whatsapp');
    expect(wa?.enabled).toBe(0);
    // Restore
    updateNotificationSettings('whatsapp', { enabled: 1 });
  });
});
