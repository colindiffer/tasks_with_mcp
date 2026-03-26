import pino from 'pino';

const usePrettyTransport =
  process.env['NODE_ENV'] !== 'production' &&
  Boolean(process.stdout.isTTY);

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: usePrettyTransport
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
