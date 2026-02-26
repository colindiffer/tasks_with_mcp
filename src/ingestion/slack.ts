import { withMcp } from '../mcp/clients.js';
import { config } from '../config/index.js';
import { getSlackCursor, setSlackCursor } from '../state/store.js';
import { logger } from '../utils/logger.js';
import type { RawMessage } from '../types/index.js';

interface SlackMessage {
  type: string;
  user?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  subtype?: string;
}

interface SlackMessagesResponse {
  messages: SlackMessage[];
  nextCursor?: string;
  hasMore: boolean;
}

interface SlackUserInfo {
  id: string;
  real_name?: string;
  display_name?: string;
  name: string;
}

interface SlackChannelInfo {
  id: string;
  name: string;
}

export async function fetchNewMessages(): Promise<RawMessage[]> {
  return withMcp('slack', async (call) => {
    const messages: RawMessage[] = [];
    const userCache = new Map<string, string>();

    // Resolve channel names up front
    const channelNames = new Map<string, string>();
    for (const channelId of config.slack.channelIds) {
      try {
        const info = await call('slack_get_channel_info', { channel_id: channelId }) as SlackChannelInfo;
        channelNames.set(channelId, `#${info.name}`);
      } catch {
        channelNames.set(channelId, channelId);
      }
    }

    for (const channelId of config.slack.channelIds) {
      try {
        const oldest = getSlackCursor(channelId);
        let newLatest: string | undefined;

        const result = await call('slack_get_messages', {
          channel_id: channelId,
          limit: 100,
          ...(oldest ? { oldest } : {}),
        }) as SlackMessagesResponse;

        for (const msg of result.messages ?? []) {
          if (!msg.text || !msg.ts) continue;
          if (msg.subtype) continue; // skip system messages

          // Resolve sender name with in-session cache
          let senderName = 'Unknown';
          if (msg.user) {
            if (!userCache.has(msg.user)) {
              try {
                const user = await call('slack_get_user_info', { user_id: msg.user }) as SlackUserInfo;
                userCache.set(msg.user, user.real_name || user.display_name || user.name || msg.user);
              } catch {
                userCache.set(msg.user, msg.user);
              }
            }
            senderName = userCache.get(msg.user)!;
          }

          messages.push({
            id: msg.ts,
            source: 'slack',
            receivedAt: new Date(parseFloat(msg.ts) * 1000),
            senderName,
            channelOrFolder: channelNames.get(channelId) ?? channelId,
            content: msg.text,
            threadId: msg.thread_ts,
          });

          if (!newLatest || msg.ts > newLatest) newLatest = msg.ts;
        }

        if (newLatest) setSlackCursor(channelId, newLatest);
        logger.info({ action: 'slack_fetched', channelId, count: messages.length }, 'Slack messages fetched');
      } catch (err) {
        logger.error({ action: 'slack_failed', channelId, err }, 'Failed to fetch Slack messages — cursor not advanced');
      }
    }

    return messages;
  });
}
