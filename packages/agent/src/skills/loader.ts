/**
 * skills/loader.ts — Skills loader for Makilab Agent
 *
 * Loads skills from packages/agent/skills/<name>/SKILL.md at startup.
 * Skills are markdown files with YAML frontmatter (name, description).
 * Technically close to Claude Code skills format for easy portability.
 *
 * Injection strategy:
 * - Index (name + description of enabled skills) → stable block (cached)
 * - Body (full SKILL.md content) → dynamic block (only if relevant to user message)
 *
 * Relevance detection: zero-cost keyword matching on description field.
 * Toggle: disabled skills are fully absent (no index, no body).
 * Cache: in-memory, invalidated by invalidateSkillsCache() on toggle.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSkillDisabled } from '../memory/sqlite.ts';
import { logger } from '../logger.ts';

export interface Skill {
  name: string;
  description: string;
  body: string;
}

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../skills');
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/s;

/** Parse simple YAML frontmatter (key: value pairs only) */
function parseSimpleYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([\w-]+):\s+(.+)$/.exec(line.trim());
    if (m) result[m[1]!] = m[2]!.replace(/^["']|["']$/g, '').trim();
  }
  return result;
}

let _cache: Skill[] | null = null;

/** Load all enabled skills from the skills directory (cached) */
export function loadSkills(): Skill[] {
  if (_cache) return _cache;

  if (!existsSync(SKILLS_DIR)) {
    logger.debug({ dir: SKILLS_DIR }, 'Skills directory not found — no skills loaded');
    return (_cache = []);
  }

  const skills: Skill[] = [];
  try {
    const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(SKILLS_DIR, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;

      try {
        const raw = readFileSync(skillPath, 'utf-8');
        const match = FM_RE.exec(raw);
        if (!match) {
          logger.warn({ skill: entry.name }, 'Skill SKILL.md has no valid frontmatter — skipping');
          continue;
        }
        const fm = parseSimpleYaml(match[1]!);
        if (!fm['name'] || !fm['description']) {
          logger.warn({ skill: entry.name }, 'Skill missing name or description — skipping');
          continue;
        }

        // Skip disabled skills entirely
        if (isSkillDisabled(fm['name'])) continue;

        skills.push({ name: fm['name'], description: fm['description'], body: match[2]!.trim() });
      } catch (err) {
        logger.warn({ skill: entry.name, err: err instanceof Error ? err.message : String(err) }, 'Failed to load skill');
      }
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Failed to read skills directory');
    return (_cache = []);
  }

  logger.info({ count: skills.length, names: skills.map((s) => s.name) }, 'Skills loaded');
  return (_cache = skills);
}

/** Invalidate the skills cache (call after toggle) */
export function invalidateSkillsCache(): void {
  _cache = null;
}

/** Extract keywords from a description string (words ≥4 chars) */
function extractKeywords(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
}

/** Return skills whose description keywords match the user message */
export function getRelevantSkills(userMessage: string): Skill[] {
  const skills = loadSkills();
  if (skills.length === 0) return [];

  const msgLower = userMessage.toLowerCase();
  return skills.filter((skill) => {
    const keywords = extractKeywords(skill.description);
    return keywords.some((kw) => msgLower.includes(kw));
  });
}

/** Build the skills index section for the stable system prompt block */
export function buildSkillsIndexPrompt(): string {
  const skills = loadSkills();
  if (skills.length === 0) return '';

  const lines = ['## Skills disponibles\n'];
  for (const skill of skills) {
    const shortDesc = skill.description.length > 120
      ? skill.description.slice(0, 120) + '…'
      : skill.description;
    lines.push(`- **${skill.name}** : ${shortDesc}`);
  }
  return lines.join('\n');
}

/** Build the skills body section for the dynamic system prompt block */
export function buildSkillsBodyPrompt(skills: Skill[]): string {
  if (skills.length === 0) return '';

  return skills.map((skill) =>
    `## Skill actif : ${skill.name}\n\n${skill.body}`
  ).join('\n\n---\n\n');
}
