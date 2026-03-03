/**
 * ocr.ts — Extract text from images using Claude Haiku vision
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

/**
 * Extract visible text from an image buffer.
 * Returns the extracted text, or null if no readable text is found.
 */
export async function extractTextFromImage(
  buffer: Buffer,
  mimetype: string,
): Promise<string | null> {
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
    max_tokens: 1000,
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
            text: 'Extrais tout le texte visible dans cette image. Retourne uniquement le texte, sans commentaire ni mise en forme supplémentaire. Si aucun texte n\'est visible, réponds exactement: AUCUN_TEXTE',
          },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
  if (!text || text === 'AUCUN_TEXTE') return null;
  return text;
}
