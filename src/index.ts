import 'dotenv/config';
import cron from 'node-cron';
import { config } from './config/index.js';
import { run } from './pipeline/runner.js';
import { startWebhookServer } from './webhook/server.js';
import { logger } from './utils/logger.js';

logger.info({ schedule: config.cron.schedule }, 'Starting tasks_with_mcp');

// Start Fathom webhook receiver
startWebhookServer();

// Run pipeline immediately on startup, then on schedule
run().catch(err => logger.error({ err }, 'Pipeline run failed'));

cron.schedule(config.cron.schedule, () => {
  run().catch(err => logger.error({ err }, 'Scheduled pipeline run failed'));
});
