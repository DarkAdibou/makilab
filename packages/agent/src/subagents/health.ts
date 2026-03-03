/**
 * health.ts — Runtime capability health checks
 *
 * Each subagent/capability has a check function that returns live status.
 * Used by GET /api/subagents/health to power the Connections page.
 */

import { config } from '../config.ts';
import { getWhatsAppStatus } from '../whatsapp/gateway.ts';
import { isObsidianLive } from './obsidian.ts';
import { getMcpStatus } from '../mcp/bridge.ts';

export interface CapabilityHealth {
  name: string;
  available: boolean;
  mode?: string;
  reason?: string;
}

async function checkObsidian(): Promise<CapabilityHealth> {
  if (!config.obsidianRestApiKey && !config.obsidianVaultPath) {
    return { name: 'obsidian', available: false, reason: 'Non configuré (OBSIDIAN_REST_API_KEY ou OBSIDIAN_VAULT_PATH manquant)' };
  }
  if (config.obsidianRestApiKey) {
    const live = await isObsidianLive();
    if (live) return { name: 'obsidian', available: true, mode: 'rest_api' };
    if (config.obsidianVaultPath) return { name: 'obsidian', available: true, mode: 'file_fallback', reason: 'REST API hors ligne' };
    return { name: 'obsidian', available: false, mode: 'rest_api', reason: 'REST API hors ligne, pas de fallback fichier' };
  }
  return { name: 'obsidian', available: true, mode: 'file_fallback' };
}

async function checkQdrant(): Promise<CapabilityHealth> {
  if (!config.qdrantUrl) return { name: 'qdrant', available: false, reason: 'QDRANT_URL non configuré' };
  try {
    const r = await fetch(`${config.qdrantUrl}/collections`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) return { name: 'qdrant', available: true, mode: 'connected' };
    return { name: 'qdrant', available: false, reason: `HTTP ${r.status}` };
  } catch {
    return { name: 'qdrant', available: false, reason: 'Hors ligne' };
  }
}

async function checkWhatsApp(): Promise<CapabilityHealth> {
  if (!config.whatsappAllowedNumber) return { name: 'whatsapp', available: false, reason: 'WHATSAPP_ALLOWED_NUMBER non configuré' };
  const { connected } = getWhatsAppStatus();
  return { name: 'whatsapp', available: connected, mode: connected ? 'connected' : 'disconnected', reason: connected ? undefined : 'Session déconnectée' };
}

async function checkHomeAssistant(): Promise<CapabilityHealth> {
  if (!config.haUrl) return { name: 'homeassistant', available: false, reason: 'HA_URL non configuré' };
  try {
    const headers: Record<string, string> = {};
    if (config.haAccessToken) headers['Authorization'] = `Bearer ${config.haAccessToken}`;
    const r = await fetch(`${config.haUrl}/api/`, { headers, signal: AbortSignal.timeout(2000) });
    if (r.ok) return { name: 'homeassistant', available: true, mode: 'connected' };
    return { name: 'homeassistant', available: false, reason: `HTTP ${r.status}` };
  } catch {
    return { name: 'homeassistant', available: false, reason: 'Hors ligne' };
  }
}

function checkWeb(): CapabilityHealth {
  if (config.searxngUrl) return { name: 'web', available: true, mode: 'SearXNG + Brave' };
  if (config.braveSearchApiKey) return { name: 'web', available: true, mode: 'Brave Search' };
  return { name: 'web', available: false, reason: 'SEARXNG_URL et BRAVE_SEARCH_API_KEY non configurés' };
}

function checkKarakeep(): CapabilityHealth {
  if (!config.karakeepApiKey) return { name: 'karakeep', available: false, reason: 'KARAKEEP_API_KEY non configuré' };
  return { name: 'karakeep', available: true };
}

async function checkMemory(): Promise<CapabilityHealth> {
  if (!config.voyageApiKey) return { name: 'memory', available: false, reason: 'VOYAGE_API_KEY non configuré' };
  const qdrant = await checkQdrant();
  if (!qdrant.available) return { name: 'memory', available: false, reason: `Qdrant: ${qdrant.reason}` };
  return { name: 'memory', available: true, mode: 'Qdrant + Voyage AI' };
}

function checkCapture(): CapabilityHealth {
  const hasObsidian = !!config.obsidianVaultPath || !!config.obsidianRestApiKey;
  const hasKarakeep = !!config.karakeepApiKey;
  if (!hasObsidian && !hasKarakeep) return { name: 'capture', available: false, reason: 'Aucune destination configurée' };
  const destinations = [hasObsidian && 'Obsidian', hasKarakeep && 'Karakeep'].filter(Boolean).join(' + ');
  return { name: 'capture', available: true, mode: destinations as string };
}

/** Run health checks for all capabilities and MCP servers */
export async function checkAllCapabilities(): Promise<CapabilityHealth[]> {
  const [obsidian, qdrant, whatsapp, homeassistant, memory] = await Promise.all([
    checkObsidian(),
    checkQdrant(),
    checkWhatsApp(),
    checkHomeAssistant(),
    checkMemory(),
  ]);

  const sync: CapabilityHealth[] = [
    checkWeb(),
    checkKarakeep(),
    checkCapture(),
    { name: 'time', available: true },
    { name: 'tasks', available: true },
    { name: 'code', available: true },
    { name: 'settings', available: true },
  ];

  const mcpStatuses = getMcpStatus();
  const mcpHealth: CapabilityHealth[] = mcpStatuses.map((s) => ({
    name: `mcp:${s.server}`,
    available: s.connected,
    mode: s.connected ? `${s.tools.length} outil(s)` : undefined,
    reason: s.connected ? undefined : 'Déconnecté',
  }));

  return [obsidian, qdrant, whatsapp, homeassistant, memory, ...sync, ...mcpHealth];
}
