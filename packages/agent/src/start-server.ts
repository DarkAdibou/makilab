import { validateConfig } from './config.ts';
import { logger } from './logger.ts';
import { buildServer } from './server.ts';
import { startCron } from './tasks/cron.ts';
import { initCollections } from './memory/qdrant.ts';
import { initMcpBridge, shutdownMcpBridge } from './mcp/bridge.ts';
import { initWhatsApp } from './whatsapp/gateway.ts';

validateConfig(logger);
startCron();

// Initialize Qdrant collections (no-op if QDRANT_URL not set)
await initCollections().catch((err) => {
  logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Qdrant init failed — semantic memory disabled');
});

// Initialize MCP bridge (no-op if no enabled servers in mcp-servers.json)
await initMcpBridge().catch((err) => {
  logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'MCP bridge init failed');
});

// Initialize WhatsApp gateway (no-op if WHATSAPP_ALLOWED_NUMBER not set)
await initWhatsApp().catch((err) => {
  logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'WhatsApp init failed');
});

const server = await buildServer();
const port = parseInt(process.env['MAKILAB_API_PORT'] ?? '3100', 10);

// Graceful shutdown
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    logger.info({ signal }, 'Shutting down...');
    await shutdownMcpBridge();
    await server.close();
    process.exit(0);
  });
}

await server.listen({ port, host: '0.0.0.0' });
logger.info(`API listening on http://0.0.0.0:${port}`);
