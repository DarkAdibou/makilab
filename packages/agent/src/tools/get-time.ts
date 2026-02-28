import type { Tool } from '@makilab/shared';

export const getTimeTool: Tool = {
  name: 'get_time',
  description: 'Returns the current date and time. Use when the user asks about time or date.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async () => {
    const now = new Date();
    return JSON.stringify({
      iso: now.toISOString(),
      sydney: now.toLocaleString('fr-FR', { timeZone: 'Australia/Sydney' }),
      paris: now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }),
    });
  },
};
