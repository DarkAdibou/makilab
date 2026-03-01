/**
 * homeassistant.ts — SubAgent: Home Assistant
 *
 * Connects to Home Assistant REST API to control smart home devices.
 * Exposes entities that the HA admin has made available.
 *
 * Auth: Long-lived access token (HA_ACCESS_TOKEN)
 * Base URL: HA_URL (e.g., http://homeassistant.local:8123)
 */

import { config } from '../config.ts';
import { logger } from '../logger.ts';
import type { SubAgent, SubAgentResult } from './types.ts';

async function haFetch(endpoint: string, method = 'GET', body?: unknown): Promise<Response> {
  return fetch(`${config.haUrl}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${config.haAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export const homeassistantSubAgent: SubAgent = {
  name: 'homeassistant',
  description:
    'Contrôle la maison connectée via Home Assistant. ' +
    'Peut lister les entités, lire leur état, et exécuter des services (allumer/éteindre lumières, etc.).',

  actions: [
    {
      name: 'list_entities',
      description: 'Liste les entités disponibles dans Home Assistant',
      inputSchema: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Filtrer par domaine (light, switch, sensor, climate...). Vide = tous.' },
        },
        required: [],
      },
    },
    {
      name: 'get_state',
      description: "Récupère l'état actuel d'une entité (lumière, capteur, thermostat...)",
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: { type: 'string', description: "ID de l'entité (ex: light.salon, sensor.temperature_bureau)" },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'call_service',
      description: 'Appelle un service Home Assistant (turn_on, turn_off, toggle, set_temperature...)',
      inputSchema: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Domaine du service (light, switch, climate, scene...)' },
          service: { type: 'string', description: 'Nom du service (turn_on, turn_off, toggle...)' },
          entity_id: { type: 'string', description: "ID de l'entité cible" },
          data: { type: 'object', description: 'Données additionnelles (brightness, temperature...)', properties: {}, required: [] },
        },
        required: ['domain', 'service', 'entity_id'],
      },
    },
    {
      name: 'assist',
      description: 'Envoie une commande en langage naturel au pipeline Assist de Home Assistant',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Commande en langage naturel (ex: "allume la lumière du salon")' },
        },
        required: ['text'],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    if (!config.haUrl || !config.haAccessToken) {
      return { success: false, text: 'Home Assistant non configuré (HA_URL / HA_ACCESS_TOKEN manquant)', error: 'Missing config' };
    }

    try {
      if (action === 'list_entities') return await listEntities(input['domain'] as string | undefined);
      if (action === 'get_state') return await getState(input['entity_id'] as string);
      if (action === 'call_service') {
        return await callService(
          input['domain'] as string,
          input['service'] as string,
          input['entity_id'] as string,
          input['data'] as Record<string, unknown> | undefined,
        );
      }
      if (action === 'assist') return await sendAssist(input['text'] as string);
      return { success: false, text: `Action inconnue: ${action}`, error: `Unknown action: ${action}` };
    } catch (err) {
      return { success: false, text: 'Erreur Home Assistant', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

async function listEntities(domain?: string): Promise<SubAgentResult> {
  const r = await haFetch('/api/states');
  if (!r.ok) throw new Error(`HA API ${r.status}`);
  let entities = await r.json() as Array<{ entity_id: string; state: string; attributes: { friendly_name?: string } }>;
  if (domain) entities = entities.filter(e => e.entity_id.startsWith(`${domain}.`));
  const list = entities.slice(0, 50).map(e =>
    `- **${e.entity_id}** (${e.attributes.friendly_name ?? ''}): ${e.state}`
  ).join('\n');
  return {
    success: true,
    text: `${entities.length} entité(s)${domain ? ` (domaine: ${domain})` : ''}:\n\n${list}`,
    data: entities.slice(0, 50).map(e => ({ entity_id: e.entity_id, state: e.state, name: e.attributes.friendly_name })),
  };
}

async function getState(entityId: string): Promise<SubAgentResult> {
  const r = await haFetch(`/api/states/${entityId}`);
  if (r.status === 404) return { success: false, text: `Entité non trouvée: ${entityId}`, error: 'Not found' };
  if (!r.ok) throw new Error(`HA API ${r.status}`);
  const entity = await r.json() as { entity_id: string; state: string; attributes: Record<string, unknown> };
  const attrs = Object.entries(entity.attributes)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');
  return {
    success: true,
    text: `**${entityId}**: ${entity.state}\n\nAttributs:\n${attrs}`,
    data: entity,
  };
}

async function callService(domain: string, service: string, entityId: string, data?: Record<string, unknown>): Promise<SubAgentResult> {
  logger.info({ domain, service, entityId }, 'HA: calling service');
  const payload = { entity_id: entityId, ...(data ?? {}) };
  const r = await haFetch(`/api/services/${domain}/${service}`, 'POST', payload);
  if (!r.ok) throw new Error(`HA service ${r.status}: ${await r.text()}`);
  return {
    success: true,
    text: `Service ${domain}.${service} exécuté sur ${entityId}`,
    data: { domain, service, entityId },
  };
}

async function sendAssist(text: string): Promise<SubAgentResult> {
  logger.info({ text }, 'HA: assist command');
  const r = await haFetch('/api/conversation/process', 'POST', { text, language: 'fr' });
  if (!r.ok) throw new Error(`HA Assist ${r.status}`);
  const result = await r.json() as { response: { speech: { plain: { speech: string } } } };
  const speech = result.response?.speech?.plain?.speech ?? 'Pas de réponse';
  return { success: true, text: `Assist: ${speech}`, data: result };
}
