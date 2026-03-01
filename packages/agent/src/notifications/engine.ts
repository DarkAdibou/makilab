import { createNotification, getNotificationSettings } from '../memory/sqlite.ts';
import { logger } from '../logger.ts';

export interface NotificationPayload {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  link?: string;
}

/** Create notification + dispatch to active channels based on settings */
export async function notify(payload: NotificationPayload): Promise<void> {
  // 1. Always store in DB (for mission_control bell)
  const id = createNotification({
    type: payload.type,
    severity: payload.severity,
    title: payload.title,
    body: payload.body,
    link: payload.link,
  });

  // 2. Dispatch to other channels
  const settings = getNotificationSettings();
  for (const setting of settings) {
    if (!setting.enabled || setting.channel === 'mission_control') continue;

    // Check type filter
    if (setting.types_filter) {
      try {
        const allowed = JSON.parse(setting.types_filter) as string[];
        if (!allowed.includes(payload.type)) continue;
      } catch { continue; }
    }

    // Check quiet hours
    if (isQuietHours(setting.quiet_hours_start, setting.quiet_hours_end)) continue;

    // Dispatch
    try {
      if (setting.channel === 'whatsapp') {
        await dispatchWhatsApp(payload);
      } else if (setting.channel === 'email') {
        await dispatchEmail(payload);
      }
    } catch (err) {
      logger.warn({ channel: setting.channel, err: err instanceof Error ? err.message : String(err) }, 'Notification dispatch failed');
    }
  }

  logger.info({ type: payload.type, id }, 'Notification created');
}

function isQuietHours(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  // Normal range (e.g., 08:00-17:00)
  if (start <= end) return hhmm >= start && hhmm < end;
  // Overnight range (e.g., 22:00-08:00)
  return hhmm >= start || hhmm < end;
}

async function dispatchWhatsApp(payload: NotificationPayload): Promise<void> {
  try {
    const { sendWhatsAppMessage } = await import('../whatsapp/gateway.ts');
    await sendWhatsAppMessage(`${payload.title}\n\n${payload.body}`);
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'WhatsApp notification skipped');
  }
}

async function dispatchEmail(_payload: NotificationPayload): Promise<void> {
  // Stub — will use Gmail subagent in the future
  logger.debug({}, 'Email notification (stub — not implemented)');
}
