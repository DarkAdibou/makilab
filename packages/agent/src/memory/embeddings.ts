/**
 * embeddings.ts — Voyage AI embedding client
 *
 * Wraps Voyage AI's voyage-3 model to generate 1024-dim embeddings.
 * Used by Qdrant for semantic search (E9).
 *
 * Returns null when VOYAGE_API_KEY is not configured (graceful degradation).
 */

import { VoyageAIClient } from 'voyageai';
import { config } from '../config.ts';
import { logger } from '../logger.ts';

export const EMBEDDING_DIMENSION = 1024;

let client: VoyageAIClient | null = null;

function getClient(): VoyageAIClient | null {
  if (!config.voyageApiKey) return null;
  if (!client) {
    client = new VoyageAIClient({ apiKey: config.voyageApiKey });
  }
  return client;
}

/**
 * Embed a single text string. Returns null if API key is not configured.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const c = getClient();
  if (!c) return null;

  try {
    const response = await c.embed({
      input: [text],
      model: 'voyage-3',
    });
    return response.data?.[0]?.embedding ?? null;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Embedding failed');
    return null;
  }
}

/**
 * Embed multiple texts in a single batch call. Returns null if API key is not configured.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const c = getClient();
  if (!c) return null;

  try {
    const response = await c.embed({
      input: texts,
      model: 'voyage-3',
    });
    return response.data?.map((d) => d.embedding!) ?? null;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Batch embedding failed');
    return null;
  }
}
