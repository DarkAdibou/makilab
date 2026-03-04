/**
 * capture.ts — SubAgent: Smart Capture
 *
 * Classifie le contenu entrant et le route vers Obsidian et/ou Karakeep.
 *
 * Actions:
 *   - classify : analyse le contenu et retourne type + confiance + destinations
 *   - route    : exécute le routing vers les destinations détectées
 *
 * Logique confiance :
 *   - > 0.8  : Claude route automatiquement (auto)
 *   - 0.5-0.8 : Claude propose à l’utilisateur avant d’agir
 *   - < 0.5  : Stocké dans Captures/Inbox/ sans classification
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { SubAgent, SubAgentResult } from './types.ts';
import type { CaptureClassification, CaptureType } from '@makilab/shared';
import { createLlmClient } from '../llm/client.ts';
import { findSubAgent } from './registry.ts';

const llm = createLlmClient();

export const captureSubAgent: SubAgent = {
  name: 'capture',
  description:
    'Classifie et route le contenu entrant (URL, note, idée, tâche, code, etc.) ' +
    'vers Obsidian et/ou Karakeep. Utilise pour tout ce qui ressemble à une capture : ' +
    '"note ça", "sauvegarde", "bookmark", "remember", URL nue, snippet de code, idée.',

  actions: [
    {
      name: 'classify',
      description: 'Analyse le contenu et détermine son type, sa confiance et ses destinations',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Le contenu à classifier (texte, URL, note...)' },
        },
        required: ['content'],
      },
    },
    {
      name: 'save_temp',
      description: 'Sauve une image base64 dans un fichier temporaire local et retourne le chemin file:// pour un upload Drive. Utilise avant mcp_google-workspace__create_drive_file pour uploader une image.',
      inputSchema: {
        type: 'object',
        properties: {
          base64: { type: 'string', description: 'Contenu de l\'image encodé en base64' },
          mimeType: { type: 'string', description: 'MIME type (image/jpeg, image/png...)' },
          filename: { type: 'string', description: 'Nom de fichier souhaité (ex: facture-2026-03-04.jpg)' },
        },
        required: ['base64', 'mimeType', 'filename'],
      },
    },
    {
      name: 'route',
      description: 'Route le contenu vers les destinations (obsidian, karakeep) selon la classification',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Le contenu à router' },
          type: { type: 'string', description: 'Type de capture (ex: url, idea, snippet...)' },
          confidence: { type: 'string', description: 'Score de confiance 0-1' },
          destinations: { type: 'string', description: 'Destinations JSON array (ex: ["obsidian","karakeep"])' },
          entities: { type: 'string', description: 'Entités extraites JSON object (ex: {"url":"...","title":"..."})' },
        },
        required: ['content', 'type', 'confidence', 'destinations'],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    try {
      if (action === 'classify') {
        return await classifyContent(input['content'] as string);
      }
      if (action === 'save_temp') {
        return saveTempImage(
          input['base64'] as string,
          input['mimeType'] as string,
          input['filename'] as string,
        );
      }
      if (action === 'route') {
        const destinations = JSON.parse(input['destinations'] as string) as string[];
        const entities = input['entities']
          ? JSON.parse(input['entities'] as string) as Record<string, string>
          : {};
        return await routeContent({
          content: input['content'] as string,
          type: input['type'] as CaptureType,
          confidence: parseFloat(input['confidence'] as string),
          destinations,
          entities,
        });
      }
      return { success: false, text: `Action inconnue: ${action}`, error: `Unknown action: ${action}` };
    } catch (err) {
      return {
        success: false,
        text: 'Erreur Smart Capture',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ── Temp image save ───────────────────────────────────────────────────────────────────────────────

const TEMP_DIR = join(tmpdir(), 'makilab-uploads');

function saveTempImage(base64: string, mimeType: string, filename: string): SubAgentResult {
  try {
    mkdirSync(TEMP_DIR, { recursive: true });
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
    const filePath = join(TEMP_DIR, `${randomUUID()}-${safeName}`);
    writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return {
      success: true,
      text: `file://${filePath.replace(/\\/g, '/')}`,
      data: { filePath, fileUrl: `file://${filePath.replace(/\\/g, '/')}` },
    };
  } catch (err) {
    return {
      success: false,
      text: 'Erreur lors de la sauvegarde temporaire',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Classification ────────────────────────────────────────────────────────────────────────────────

const CAPTURE_TYPES: CaptureType[] = [
  'company', 'contact', 'url', 'prompt', 'snippet',
  'idea', 'meeting_note', 'task', 'quote', 'unknown',
];

const ROUTING_MAP: Record<CaptureType, { destinations: string[]; obsidianFolder: string }> = {
  url:          { destinations: ['karakeep', 'obsidian'], obsidianFolder: 'Captures/URLs' },
  company:      { destinations: ['karakeep', 'obsidian'], obsidianFolder: 'Captures/Companies' },
  contact:      { destinations: ['obsidian'],             obsidianFolder: 'Captures/Contacts' },
  idea:         { destinations: ['obsidian'],             obsidianFolder: 'Captures/Ideas' },
  snippet:      { destinations: ['obsidian'],             obsidianFolder: 'Captures/Snippets' },
  prompt:       { destinations: ['obsidian'],             obsidianFolder: 'Captures/Prompts' },
  meeting_note: { destinations: ['obsidian'],             obsidianFolder: 'Captures/Meetings' },
  task:         { destinations: ['obsidian'],             obsidianFolder: 'Captures/Tasks' },
  quote:        { destinations: ['obsidian'],             obsidianFolder: 'Captures/Quotes' },
  unknown:      { destinations: ['obsidian'],             obsidianFolder: 'Captures/Inbox' },
};

async function classifyContent(content: string): Promise<SubAgentResult> {
  const prompt = `Tu es un classifier de contenu. Analyse ce contenu et retourne un JSON.

Types possibles : ${CAPTURE_TYPES.join(', ')}

Règles :
- "url" si c'est une URL (commence par http/https ou ressemble à un lien)
- "company" si c'est une entreprise avec contexte business
- "contact" si c'est une personne (nom + coordonnées ou contexte)
- "snippet" si c'est du code
- "prompt" si c'est un prompt AI
- "idea" si c'est une idée, réflexion, concept
- "meeting_note" si c'est une note de réunion
- "task" si c'est une tâche à faire
- "quote" si c'est une citation
- "unknown" si tu n'es pas sûr

Retourne UNIQUEMENT ce JSON (pas de markdown, pas d'explication) :
{
  "type": "<type>",
  "confidence": <0.0-1.0>,
  "title": "<titre court max 60 chars>",
  "entities": {
    "url": "<si présente>",
    "name": "<si personne ou entreprise>",
    "tags": "<tags séparés par virgule>"
  }
}

Contenu à classifier :
${content.substring(0, 2000)}`;

  const response = await llm.chat({
    taskType: 'classification',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 256,
  });

  const raw = response.content.find((b) => b.type === 'text')?.text ?? '{}';
  // Strip markdown code fences if present (Haiku sometimes wraps JSON)
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  let parsed: { type?: string; confidence?: number; title?: string; entities?: Record<string, string> };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return {
      success: false,
      text: `Échec classification (JSON invalide): ${raw.substring(0, 100)}`,
      error: 'Invalid JSON from classifier',
    };
  }

  const type = (CAPTURE_TYPES.includes(parsed.type as CaptureType) ? parsed.type : 'unknown') as CaptureType;
  const confidence = typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5;
  const routing = ROUTING_MAP[type];
  const entities = parsed.entities ?? {};
  if (parsed.title) entities['title'] = parsed.title;

  const classification: CaptureClassification = {
    type,
    confidence,
    destinations: routing.destinations,
    entities,
  };

  const confidenceLabel = confidence >= 0.8 ? '✅ auto' : confidence >= 0.5 ? '⚠️ à confirmer' : '📥 inbox';

  return {
    success: true,
    text: `Classification : **${type}** (confiance: ${(confidence * 100).toFixed(0)}% ${confidenceLabel})
Destinations : ${routing.destinations.join(', ')}
Entités : ${JSON.stringify(entities)}`,
    data: classification,
  };
}

// ── Routing ───────────────────────────────────────────────────────────────────────────────────

function buildObsidianPath(type: CaptureType, entities: Record<string, string>): string {
  const folder = ROUTING_MAP[type].obsidianFolder;
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const title = (entities['title'] ?? 'capture')
    .replace(/[/\\:*?"<>|]/g, '-') // sanitize filename
    .substring(0, 60);
  return `${folder}/${date}-${title}.md`;
}

function buildObsidianContent(
  content: string,
  type: CaptureType,
  entities: Record<string, string>,
): string {
  const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const tags = entities['tags'] ? entities['tags'].split(',').map((t) => t.trim()) : [type];
  const frontmatter = [
    '---',
    `type: ${type}`,
    `captured: ${date}`,
    `tags: [${tags.join(', ')}]`,
    entities['url'] ? `url: "${entities['url']}"` : null,
    entities['name'] ? `name: "${entities['name']}"` : null,
    '---',
  ].filter(Boolean).join('\n');

  return `${frontmatter}\n\n${content}`;
}

async function routeContent(classification: CaptureClassification & { content: string }): Promise<SubAgentResult> {
  const { content, type, destinations, entities } = classification;
  const results: string[] = [];
  const errors: string[] = [];

  // ── Obsidian ────────────────────────────────────────────────────────────────────────────────────
  if (destinations.includes('obsidian')) {
    const obsidian = findSubAgent('obsidian');
    if (!obsidian) {
      errors.push('Obsidian: subagent non trouvé dans le registry');
    } else {
      const path = buildObsidianPath(type, entities);
      const mdContent = buildObsidianContent(content, type, entities);
      const result = await obsidian.execute('create', { path, content: mdContent });
      if (result.success) {
        results.push(`📝 Obsidian : ${path}`);
      } else {
        errors.push(`Obsidian: ${result.error ?? result.text}`);
      }
    }
  }

  // ── Karakeep ───────────────────────────────────────────────────────────────────────────────────
  if (destinations.includes('karakeep') && (entities['url'] ?? type === 'company')) {
    const karakeep = findSubAgent('karakeep');
    if (!karakeep) {
      errors.push('Karakeep: subagent non trouvé dans le registry');
    } else {
      const tags = entities['tags'] ? entities['tags'].split(',').map((t) => t.trim()) : [type];
      const result = await karakeep.execute('create', {
        url: entities['url'] ?? '',
        title: entities['title'] ?? content.substring(0, 60),
        tags: JSON.stringify(tags),
      });
      if (result.success) {
        results.push(`🔖 Karakeep : bookmark créé`);
      } else {
        errors.push(`Karakeep: ${result.error ?? result.text}`);
      }
    }
  }

  if (results.length === 0 && errors.length === 0) {
    return { success: false, text: 'Aucune destination exécutée', error: 'No destinations matched' };
  }

  const successText = results.length > 0 ? `Capture enregistrée :\n${results.join('\n')}` : '';
  const errorText = errors.length > 0 ? `\nErreurs : ${errors.join(', ')}` : '';

  return {
    success: errors.length === 0,
    text: successText + errorText,
    data: { type, destinations, results, errors },
  };
}
