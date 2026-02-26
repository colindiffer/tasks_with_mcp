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
    accessToken: require_env('SLACK_ACCESS_TOKEN'),
    channelIds: require_env('SLACK_CHANNEL_IDS').split(',').map(id => id.trim()),
  },
  outlook: {
    tenantId: optional_env('AZURE_TENANT_ID', ''),
    clientId: optional_env('AZURE_CLIENT_ID', ''),
    clientSecret: optional_env('AZURE_CLIENT_SECRET', ''),
    userEmail: optional_env('OUTLOOK_USER_EMAIL', ''),
  },
  fathom: {
    apiKey: require_env('FATHOM_API_KEY'),
    mcpServerPath: optional_env('FATHOM_MCP_SERVER_PATH', 'C:/Users/ColinDiffer/mcp-fathom-server/dist/index.js'),
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
