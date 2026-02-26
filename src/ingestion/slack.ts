import { WebClient } from '@slack/web-api';
import { config } from '../config/index.js';
import { getSlackCursor, setSlackCursor } from '../state/store.js';
import { logger } from '../utils/logger.js';
import type { RawMessage } from '../types/index.js';

const slack = new WebClient(config.slack.botToken);

export async function fetchNewMessages(): Promise<RawMessage[]> {
  const messages: RawMessage[] = [];

  for (const channelId of config.slack.channelIds) {
    try {
      const oldest = getSlackCursor(channelId);
      let newLatest: string | undefined;

      const result = await slack.conversations.history({
        channel: channelId,
        oldest,
        limit: 100,
        inclusive: false,
      });

      const channelInfo = await slack.conversations.info({ channel: channelId }).catch(() => null);
      const channelName = channelInfo?.channel && 'name' in channelInfo.channel
        ? `#${channelInfo.channel.name}`
        : channelId;

      for (const msg of result.messages ?? []) {
        if (!msg.text || !msg.ts) continue;
        if (msg.subtype) continue; // skip system messages (joins, channel changes, etc.)

        // Resolve sender display name
        let senderName = 'Unknown';
        if (msg.user) {
          const userInfo = await slack.users.info({ user: msg.user }).catch(() => null);
          if (userInfo?.user && 'real_name' in userInfo.user) {
            senderName = (userInfo.user.real_name as string) ?? msg.user;
          }
        }

        const permalink = await slack.chat.getPermalink({ channel: channelId, message_ts: msg.ts })
          .then(r => r.permalink ?? undefined)
          .catch(() => undefined);

        messages.push({
          id: msg.ts,
          source: 'slack',
          receivedAt: new Date(parseFloat(msg.ts) * 1000),
          senderName,
          channelOrFolder: channelName,
          content: msg.text,
          permalink,
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
}
