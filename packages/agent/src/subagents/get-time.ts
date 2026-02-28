/**
 * get-time.ts — SubAgent: Heure et date
 *
 * Renvoie l'heure actuelle en plusieurs fuseaux horaires.
 * Sert aussi de subagent de référence pour créer de nouveaux subagents.
 *
 * Actions:
 *   - get       : heure ISO + Sydney + Paris (aucun paramètre)
 *   - get_timezone : heure dans un fuseau IANA spécifique
 */

import type { SubAgent, SubAgentResult } from './types.ts';

export const getTimeSubAgent: SubAgent = {
  name: 'time',

  description:
    "Renvoie la date et l'heure actuelles dans différents fuseaux horaires. " +
    "Utilise quand l'utilisateur demande quelle heure il est, la date, le jour de la semaine, etc.",

  actions: [
    {
      name: 'get',
      description: "Heure actuelle en ISO, Sydney (Australia/Sydney) et Paris (Europe/Paris)",
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_timezone',
      description: "Heure actuelle dans un fuseau horaire IANA spécifique",
      inputSchema: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Fuseau IANA ex: America/New_York, Europe/London, Asia/Tokyo',
          },
        },
        required: ['timezone'],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    try {
      const now = new Date();

      if (action === 'get') {
        const sydney = now.toLocaleString('fr-FR', { timeZone: 'Australia/Sydney' });
        const paris = now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
        return {
          success: true,
          text: `Heure actuelle — ISO: ${now.toISOString()} | Sydney: ${sydney} | Paris: ${paris}`,
          data: { iso: now.toISOString(), sydney, paris },
        };
      }

      if (action === 'get_timezone') {
        const tz = input['timezone'] as string;
        const local = now.toLocaleString('fr-FR', { timeZone: tz });
        return {
          success: true,
          text: `Heure à ${tz} : ${local}`,
          data: { iso: now.toISOString(), timezone: tz, local },
        };
      }

      return {
        success: false,
        text: `Action inconnue : ${action}`,
        error: `Action '${action}' non supportée par le subagent time`,
      };
    } catch (err) {
      return {
        success: false,
        text: `Erreur lors de la récupération de l'heure`,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
