function require_env(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional_env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optional_date_env(key: string): Date | undefined {
  const value = process.env[key];
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date environment variable: ${key}`);
  }
  return parsed;
}

function optional_bool_env(key: string, fallback = false): boolean {
  const value = process.env[key];
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function optional_int_env(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer environment variable: ${key}`);
  }
  return parsed;
}

export const config = {
  ingestion: {
    maxCatchupDays: optional_int_env('MAX_CATCHUP_DAYS', 30),
  },
  slack: {
    accessToken: require_env('SLACK_ACCESS_TOKEN'),
    fullDmSweep: optional_bool_env('SLACK_FULL_DM_SWEEP'),
    dmDiscoveryLimit: optional_int_env('SLACK_DM_DISCOVERY_LIMIT', 10),
    dmRecentWindowHours: optional_int_env('SLACK_DM_RECENT_WINDOW_HOURS', 48),
    dmExcludeList: optional_env('SLACK_DM_EXCLUDELIST', '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
    monitorThreadChannels: optional_env('SLACK_MONITOR_THREAD_CHANNELS', 'gtm_monitor_checks')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
  },
  outlook: {
    tenantId: optional_env('AZURE_TENANT_ID', ''),
    clientId: optional_env('AZURE_CLIENT_ID', ''),
    clientSecret: optional_env('AZURE_CLIENT_SECRET', ''),
    userEmail: optional_env('OUTLOOK_USER_EMAIL', ''),
  },
  openai: {
    apiKey: require_env('OPENAI_API_KEY'),
    model: optional_env('OPENAI_MODEL', 'gpt-4.1-mini'),
  },
  trello: {
    apiKey: require_env('TRELLO_API_KEY'),
    token: require_env('TRELLO_TOKEN'),
    boardId: require_env('TRELLO_BOARD_ID'),
    intakeListId: require_env('TRELLO_INTAKE_LIST_ID'),
    feedbackListId: optional_env('TRELLO_FEEDBACK_LIST_ID', ''),
  },
  cron: {
    schedule: optional_env('CRON_SCHEDULE', '*/15 * * * *'),
    monitorSchedule: optional_env('SLACK_MONITOR_CRON_SCHEDULE', '*/5 * * * *'),
    slackFullSweepSchedule: optional_env('SLACK_FULL_SWEEP_CRON_SCHEDULE', '0 0 * * *'),
    startupFullSweep: optional_bool_env('STARTUP_FULL_SWEEP', false),
  },
  backfill: {
    since: optional_date_env('BACKFILL_SINCE'),
    until: optional_date_env('BACKFILL_UNTIL'),
  },
} as const;
