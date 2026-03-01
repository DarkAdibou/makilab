/**
 * semantic-indexer.ts — Fire-and-forget semantic indexation
 *
 * Called after each exchange, compaction, and fact extraction to embed
 * content into Qdrant. Failures are logged but never block the main flow.
 */

import { embedText } from './embeddings.ts';
import { upsertConversation, upsertKnowledge } from './qdrant.ts';
import { logger } from '../logger.ts';

/** Embed and index a conversation exchange (fire-and-forget) */
export async function indexConversation(
  channel: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  try {
    const combined = `User: ${userMessage}\nAssistant: ${assistantMessage}`;
    const vector = await embedText(combined);
    if (!vector) return;

    await upsertConversation({ vector, channel, userMessage, assistantMessage });
    logger.info({ channel }, 'Conversation indexed in Qdrant');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Conversation indexation failed (non-critical)');
  }
}

/** Embed and index a compaction summary (fire-and-forget) */
export async function indexSummary(
  channel: string,
  summary: string,
): Promise<void> {
  try {
    const vector = await embedText(summary);
    if (!vector) return;

    await upsertKnowledge({ vector, type: 'summary', content: summary, channel });
    logger.info({ channel }, 'Summary indexed in Qdrant');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Summary indexation failed (non-critical)');
  }
}

/** Embed and index a fact (fire-and-forget) */
export async function indexFact(key: string, value: string): Promise<void> {
  try {
    const vector = await embedText(`${key}: ${value}`);
    if (!vector) return;

    await upsertKnowledge({ vector, type: 'fact', content: `${key}: ${value}`, key });
    logger.info({ key }, 'Fact indexed in Qdrant');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Fact indexation failed (non-critical)');
  }
}
