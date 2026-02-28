import type { Tool } from '@makilab/shared';
import { getTimeTool } from './get-time.ts';

export const tools: Tool[] = [
  getTimeTool,
  // Subagent tools added here as epics progress
];

export function findTool(name: string): Tool | undefined {
  return tools.find((t) => t.name === name);
}
