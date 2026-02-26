import 'dotenv/config';
import cron from 'node-cron';
import { config } from './config/index.js';
import { run } from './pipeline/runner.js';
import { logger } from './utils/logger.js';

logger.info({ schedule: config.cron.schedule }, 'Starting tasks_with_mcp');

// Run pipeline immediately on startup, then on schedule
run().catch(err => logger.error({ err }, 'Pipeline run failed'));

cron.schedule(config.cron.schedule, () => {
  run().catch(err => logger.error({ err }, 'Scheduled pipeline run failed'));
});
