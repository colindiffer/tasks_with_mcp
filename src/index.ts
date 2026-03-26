import 'dotenv/config';
import cron from 'node-cron';
import { config } from './config/index.js';
import { run } from './pipeline/runner.js';
import { getCursorStateFile, getOutlookRefreshTokenFile, getStateDir } from './state/paths.js';
import { logger } from './utils/logger.js';

logger.info({
  schedule: config.cron.schedule,
  monitorSchedule: config.cron.monitorSchedule,
  slackFullSweepSchedule: config.cron.slackFullSweepSchedule,
  startupFullSweep: config.cron.startupFullSweep,
  stateDir: getStateDir(),
  cursorStateFile: getCursorStateFile(),
  outlookTokenFile: getOutlookRefreshTokenFile(),
}, 'Starting CPA');
let running = false;

async function runOnce(options?: {
  slackFullDmSweep?: boolean;
  teamsFullSweep?: boolean;
  sources?: Array<'slack' | 'outlook' | 'teams'>;
  slackOptions?: {
    includeMentions?: boolean;
    includeMonitorThreads?: boolean;
    includeDms?: boolean;
  };
}) {
  if (running) {
    logger.warn('Pipeline already running — skipping this tick');
    return;
  }
  running = true;
  try {
    await run(options);
  } catch (err) {
    logger.error({ err }, 'Pipeline run failed');
  } finally {
    running = false;
  }
}

// Run pipeline immediately on startup, then on schedule
runOnce({
  slackFullDmSweep: config.cron.startupFullSweep,
  teamsFullSweep: config.cron.startupFullSweep,
});

cron.schedule(config.cron.schedule, () => { runOnce(); });
cron.schedule(config.cron.monitorSchedule, () => {
  runOnce({
    sources: ['slack'],
    slackOptions: {
      includeMentions: false,
      includeMonitorThreads: true,
      includeDms: false,
    },
  });
});
cron.schedule(config.cron.slackFullSweepSchedule, () => {
  runOnce({ slackFullDmSweep: true, teamsFullSweep: true });
});
