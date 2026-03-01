import { validateConfig } from './config.ts';
import { logger } from './logger.ts';
import { buildServer } from './server.ts';
import { startCron } from './tasks/cron.ts';
import { initCollections } from './memory/qdrant.ts';

validateConfig(logger);
startCron();

// Initialize Qdrant collections (no-op if QDRANT_URL not set)
await initCollections().catch((err) => {
  logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Qdrant init failed — semantic memory disabled');
});

const server = await buildServer();
const port = parseInt(process.env['MAKILAB_API_PORT'] ?? '3100', 10);

await server.listen({ port, host: '0.0.0.0' });
logger.info(`API listening on http://0.0.0.0:${port}`);
