import type { SubAgent, SubAgentResult } from './types.ts';

export const whatsappSubAgent: SubAgent = {
  name: 'whatsapp',
  description:
    'Envoie des messages WhatsApp proactifs à l\'utilisateur autorisé. ' +
    'Utilise pour notifier l\'utilisateur, envoyer un résumé ou une alerte par WhatsApp.',

  actions: [
    {
      name: 'send',
      description: 'Envoie un message texte WhatsApp à l\'utilisateur (numéro autorisé uniquement)',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Texte du message à envoyer' },
        },
        required: ['message'],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    if (action === 'send') {
      const message = input['message'] as string;
      if (!message?.trim()) {
        return { success: false, text: 'Message vide.', error: 'empty_message' };
      }
      try {
        const { sendWhatsAppMessage } = await import('../whatsapp/gateway.ts');
        await sendWhatsAppMessage(message.trim());
        return {
          success: true,
          text: `✓ Message WhatsApp envoyé : "${message.slice(0, 80)}${message.length > 80 ? '…' : ''}"`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, text: `Échec envoi WhatsApp : ${msg}`, error: msg };
      }
    }
    return { success: false, text: `Action inconnue : ${action}`, error: 'unknown_action' };
  },
};
