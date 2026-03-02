/**
 * transcriber.ts — WhatsApp audio transcription via OpenAI Whisper API
 *
 * Accepts audio buffer (OGG/Opus from Baileys), sends to Whisper, returns text.
 * Uses raw fetch (no SDK) to minimize dependencies.
 */

import { config } from '../config.ts';
import { logger } from '../logger.ts';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

export async function transcribeAudio(audioBuffer: Buffer, mimeType = 'audio/ogg'): Promise<string | null> {
  if (!config.openaiApiKey) {
    logger.warn({}, 'OPENAI_API_KEY not set — audio transcription disabled');
    return null;
  }

  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'ogg';

  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
  formData.append('model', 'whisper-1');
  formData.append('language', 'fr');
  formData.append('response_format', 'text');

  try {
    const res = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      logger.error({ status: res.status, err }, 'Whisper API error');
      return null;
    }

    const text = (await res.text()).trim();
    logger.info({ chars: text.length }, 'Audio transcribed');
    return text;
  } catch (err) {
    logger.error({ err }, 'Whisper transcription failed');
    return null;
  }
}
