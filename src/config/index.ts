function require_env(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional_env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  slack: {
    botToken: require_env('SLACK_BOT_TOKEN'),
    channelIds: require_env('SLACK_CHANNEL_IDS').split(',').map(id => id.trim()),
  },
  outlook: {
    tenantId: require_env('AZURE_TENANT_ID'),
    clientId: require_env('AZURE_CLIENT_ID'),
    clientSecret: require_env('AZURE_CLIENT_SECRET'),
    userEmail: require_env('OUTLOOK_USER_EMAIL'),
  },
  fathom: {
    webhookSecret: require_env('FATHOM_WEBHOOK_SECRET'),
    webhookPort: parseInt(optional_env('WEBHOOK_PORT', '3001'), 10),
  },
  anthropic: {
    apiKey: require_env('ANTHROPIC_API_KEY'),
    model: 'claude-sonnet-4-6',
  },
  trello: {
    apiKey: require_env('TRELLO_API_KEY'),
    token: require_env('TRELLO_TOKEN'),
    boardId: require_env('TRELLO_BOARD_ID'),
    intakeListId: require_env('TRELLO_INTAKE_LIST_ID'),
  },
  cron: {
    schedule: optional_env('CRON_SCHEDULE', '*/15 * * * *'),
  },
} as const;
