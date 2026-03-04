/**
 * ocr.ts — Extract text and visual description from images using Claude Haiku vision
 *
 * Used by:
 * - WhatsApp imageMessage handler (session-manager.ts)
 * - POST /api/ocr (server.ts)
 *
 * Uses Anthropic SDK directly (vision requires native API, not OpenRouter routing).
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.ts';

const OCR_MODEL = 'claude-haiku-4-5-20251001';

export interface OcrResult {
  text: string | null;
  description: string;
}

/**
 * Extract visible text and visual description from an image buffer.
 * Returns { text, description } — text is null if no readable text found.
 */
export async function extractTextFromImage(
  buffer: Buffer,
  mimetype: string,
): Promise<OcrResult> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const base64 = buffer.toString('base64');

  // Normalize mimetype to what Anthropic accepts
  const mediaType = (
    mimetype === 'image/jpeg' || mimetype === 'image/jpg' ? 'image/jpeg' :
    mimetype === 'image/png' ? 'image/png' :
    mimetype === 'image/gif' ? 'image/gif' :
    'image/webp'
  ) as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

  const response = await client.messages.create({
    model: OCR_MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: 'Analyse cette image et retourne UNIQUEMENT du JSON valide :\n{\n  "text": "tout le texte visible dans l\'image, mot pour mot",\n  "description": "description concise du contenu visuel (type de document, mise en page, éléments visuels clés)"\n}\nSi aucun texte visible : "text": ""\nSi l\'image est vide/illisible : "description": "Image illisible ou vide"',
          },
        ],
      },
    ],
  });

  const raw = response.content.find((b) => b.type === 'text')?.text?.trim() ?? '';

  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned) as { text?: string; description?: string };
    const text = parsed.text?.trim() || null;
    const description = parsed.description?.trim() || 'Image';
    return { text, description };
  } catch {
    // Fallback: treat entire response as text if JSON parsing fails
    return { text: raw || null, description: 'Image' };
  }
}
