/**
 * qdrant.ts — Qdrant vector database client
 *
 * Manages two collections:
 *   conversations — each user/assistant exchange embedded for semantic search
 *   knowledge     — summaries + facts for long-term memory
 *
 * Conditional: returns early (no-op) if QDRANT_URL is not set.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { EMBEDDING_DIMENSION } from './embeddings.ts';

export const CONVERSATIONS_COLLECTION = 'conversations';
export const KNOWLEDGE_COLLECTION = 'knowledge';
export const SCORE_THRESHOLD = 0.3;

let client: QdrantClient | null = null;

function getClient(): QdrantClient | null {
  if (!config.qdrantUrl) return null;
  if (!client) {
    client = new QdrantClient({ url: config.qdrantUrl });
  }
  return client;
}

/** Create collections if they don't exist */
export async function initCollections(): Promise<void> {
  const c = getClient();
  if (!c) return;

  const { collections } = await c.getCollections();
  const existing = new Set(collections.map((col) => col.name));

  for (const name of [CONVERSATIONS_COLLECTION, KNOWLEDGE_COLLECTION]) {
    if (!existing.has(name)) {
      await c.createCollection(name, {
        vectors: { size: EMBEDDING_DIMENSION, distance: 'Cosine' },
      });
      logger.info({ collection: name }, 'Qdrant collection created');
    }
  }
}

export interface ConversationPoint {
  vector: number[];
  channel: string;
  userMessage: string;
  assistantMessage: string;
}

/** Upsert a conversation exchange into Qdrant */
export async function upsertConversation(point: ConversationPoint): Promise<void> {
  const c = getClient();
  if (!c) return;

  await c.upsert(CONVERSATIONS_COLLECTION, {
    points: [
      {
        id: randomUUID(),
        vector: point.vector,
        payload: {
          channel: point.channel,
          role: 'exchange',
          user_message: point.userMessage,
          assistant_message: point.assistantMessage,
          timestamp: new Date().toISOString(),
        },
      },
    ],
  });
}

export interface KnowledgePoint {
  vector: number[];
  type: 'summary' | 'fact';
  content: string;
  channel?: string;
  key?: string;
}

/** Upsert a knowledge point (summary or fact) into Qdrant */
export async function upsertKnowledge(point: KnowledgePoint): Promise<void> {
  const c = getClient();
  if (!c) return;

  await c.upsert(KNOWLEDGE_COLLECTION, {
    points: [
      {
        id: randomUUID(),
        vector: point.vector,
        payload: {
          type: point.type,
          content: point.content,
          channel: point.channel ?? null,
          key: point.key ?? null,
          timestamp: new Date().toISOString(),
        },
      },
    ],
  });
}

export interface SearchResult {
  score: number;
  payload: Record<string, unknown>;
}

/**
 * Search both collections for semantically similar content.
 * Returns results above SCORE_THRESHOLD, sorted by score descending.
 */
export async function semanticSearch(
  vector: number[],
  limit: number = 5,
): Promise<SearchResult[]> {
  const c = getClient();
  if (!c) return [];

  const [convResults, knowResults] = await Promise.all([
    c.search(CONVERSATIONS_COLLECTION, { vector, limit, with_payload: true }),
    c.search(KNOWLEDGE_COLLECTION, { vector, limit, with_payload: true }),
  ]);

  const all = [...convResults, ...knowResults]
    .filter((r) => r.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => ({
      score: r.score,
      payload: r.payload as Record<string, unknown>,
    }));

  return all;
}
