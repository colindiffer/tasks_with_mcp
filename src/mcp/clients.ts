import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export type McpServer = 'slack' | 'trello' | 'fathom';
export type McpCallFn = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

function buildEnv(extras: Record<string, string>): Record<string, string> {
  const base = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  return { ...base, ...extras };
}

function createTransport(server: McpServer): StdioClientTransport {
  switch (server) {
    case 'slack':
      return new StdioClientTransport({
        command: 'cmd',
        args: ['/c', 'npx', '-y', 'mcp-server-slack'],
        env: buildEnv({ SLACK_ACCESS_TOKEN: config.slack.accessToken }),
        stderr: 'pipe',
      });
    case 'trello':
      return new StdioClientTransport({
        command: 'cmd',
        args: ['/c', 'npx', '-y', '@delorenj/mcp-server-trello'],
        env: buildEnv({
          TRELLO_API_KEY: config.trello.apiKey,
          TRELLO_TOKEN: config.trello.token,
        }),
        stderr: 'pipe',
      });
    case 'fathom':
      return new StdioClientTransport({
        command: 'node',
        args: [config.fathom.mcpServerPath],
        env: buildEnv({ FATHOM_API_KEY: config.fathom.apiKey }),
        stderr: 'pipe',
      });
  }
}

export async function withMcp<T>(
  server: McpServer,
  fn: (call: McpCallFn) => Promise<T>
): Promise<T> {
  const transport = createTransport(server);
  const client = new Client({ name: 'tasks-pipeline', version: '1.0.0' });
  await client.connect(transport);
  logger.debug({ server }, 'MCP session opened');

  try {
    const call: McpCallFn = async (toolName, args) => {
      const result = await client.callTool({ name: toolName, arguments: args }) as {
        content: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };
      const text = result.content.find(c => c.type === 'text')?.text ?? 'null';
      if (result.isError) throw new Error(`MCP tool ${toolName} error: ${text}`);
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    };
    return await fn(call);
  } finally {
    await transport.close().catch(() => {});
    logger.debug({ server }, 'MCP session closed');
  }
}
