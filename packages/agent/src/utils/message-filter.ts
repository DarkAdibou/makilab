/**
 * message-filter.ts — Trivial message detection
 *
 * Used to skip expensive LLM calls (fact extraction, semantic retrieval)
 * for short/trivial messages that contain no useful information.
 */

const TRIVIAL_PATTERN =
  /^(?:oui|non|ok|okay|ouais|nope|si|yes|no|yep|nah|merci|thanks|thank you|ça marche|ça roule|parfait|super|nickel|d'accord|cool|bien|good|compris|entendu|voilà|voila|hmm+|hm+|ah+|oh+|euh+|bah+|👍|🙏|✅)\s*[!?.]*$/iu;

/**
 * Returns true if the message is too trivial to warrant
 * LLM processing (fact extraction, semantic retrieval).
 *
 * Criteria: empty, or short (<= 20 chars) affirmations/negations/thanks.
 */
export function isTrivialMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length <= 20 && TRIVIAL_PATTERN.test(trimmed)) return true;
  return false;
}
