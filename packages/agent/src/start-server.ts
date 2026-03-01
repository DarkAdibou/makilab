import { validateConfig } from './config.ts';
import { logger } from './logger.ts';
import { buildServer } from './server.ts';
import { startCron } from './tasks/cron.ts';

validateConfig(logger);
startCron();

const server = await buildServer();
const port = parseInt(process.env['MAKILAB_API_PORT'] ?? '3100', 10);

await server.listen({ port, host: '0.0.0.0' });
logger.info(`API listening on http://0.0.0.0:${port}`);
