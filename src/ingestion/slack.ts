import { WebClient } from '@slack/web-api';
import { config } from '../config/index.js';
import { getSlackCursor, setSlackCursor } from '../state/store.js';
import { logger } from '../utils/logger.js';
import type { RawMessage } from '../types/index.js';

const MENTIONS_KEY = '__mentions__';
const MONITOR_THREAD_CURSOR_PREFIX = '__monitor_thread__:';
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DELAY_MS = 3000; // ~20 req/min — conservative to avoid rate limits

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const userCache = new Map<string, string>();
const channelIdCache = new Map<string, string>();

type SlackConversation = {
  id?: string;
  name?: string;
  is_im?: boolean;
  user?: string;
  updated?: number;
  priority?: number;
  latest?: {
    ts?: string;
  };
};

type SlackHistoryMessage = {
  ts?: string;
  text?: string;
  username?: string;
  user?: string;
  thread_ts?: string;
  subtype?: string;
};

type SlackSearchMatch = Record<string, unknown> & {
  ts?: string;
  text?: string;
  username?: string;
  user?: string;
  permalink?: string;
  thread_ts?: string;
  channel?: {
    id?: string;
    name?: string;
  };
};

async function resolveUser(client: WebClient, userId: string): Promise<string> {
  if (userCache.has(userId)) return userCache.get(userId)!;
  try {
    const info = await client.users.info({ user: userId });
    const name = info.user?.real_name || info.user?.name || userId;
    userCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

export async function fetchNewMessages(options?: {
  fullDmSweep?: boolean;
  includeMentions?: boolean;
  includeMonitorThreads?: boolean;
  includeDms?: boolean;
}): Promise<RawMessage[]> {
  const client = new WebClient(config.slack.accessToken);
  const messages: RawMessage[] = [];
  const rollingFloorMs = Date.now() - config.ingestion.maxCatchupDays * DAY_MS;
  const sinceMs = config.backfill.since?.getTime() ?? rollingFloorMs;
  const cutoffMs = config.backfill.until?.getTime();
  const isBackfill = Boolean(config.backfill.since || cutoffMs);
  const fullDmSweep = options?.fullDmSweep ?? config.slack.fullDmSweep ?? Boolean(config.backfill.since);
  const includeMentions = options?.includeMentions ?? true;
  const includeMonitorThreads = options?.includeMonitorThreads ?? true;
  const includeDms = options?.includeDms ?? true;

  // Resolve our own user ID for mention search
  const auth = (includeMentions || includeDms)
    ? await client.auth.test().catch(err => {
      logger.warn({ action: 'slack_auth_test_failed', err }, 'Failed to resolve Slack self user ID');
      return undefined;
    })
    : undefined;
  const userId = auth?.user_id as string | undefined;

  // --- @mentions across all channels ---
  if (includeMentions && userId) try {
    const mentionCursor = isBackfill ? undefined : getSlackCursor(MENTIONS_KEY);
    let newestTs: string | undefined;
    let page = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      const result = await client.search.messages({
        query: `<@${userId}>`,
        sort: 'timestamp',
        sort_dir: 'desc',
        count: 100,
        page,
      });

      const matches = (result.messages?.matches ?? []) as Array<Record<string, unknown>>;
      if (matches.length === 0) break;

      let sawOlderThanCursor = false;

      for (const match of matches) {
        const ts = match.ts as string;
        if (!ts || !match.text) continue;
        if (mentionCursor && ts <= mentionCursor) {
          sawOlderThanCursor = true;
          continue;
        }
        if (sinceMs && parseFloat(ts) * 1000 < sinceMs) {
          sawOlderThanCursor = true;
          continue;
        }
        if (cutoffMs && parseFloat(ts) * 1000 > cutoffMs) continue;

        const channel = match.channel as Record<string, string> | undefined;
        messages.push({
          id: `mention_${ts}`,
          source: 'slack',
          receivedAt: new Date(parseFloat(ts) * 1000),
          senderName: (match.username as string) || 'Unknown',
          channelOrFolder: channel?.name ? `#${channel.name}` : 'slack',
          content: match.text as string,
          permalink: match.permalink as string | undefined,
          threadId: typeof match.thread_ts === 'string' ? match.thread_ts : undefined,
          conversationId: channel?.id ? `slack_channel:${channel.id}` : channel?.name ? `slack_channel:${channel.name}` : undefined,
          isFromSelf: typeof match.user === 'string' && userId ? match.user === userId : undefined,
        });

        if (!newestTs || ts > newestTs) newestTs = ts;
      }

      const totalPages = result.messages?.paging?.pages ?? page;
      hasMorePages = page < totalPages && !sawOlderThanCursor;
      page += 1;
    }

    if (newestTs && !isBackfill) setSlackCursor(MENTIONS_KEY, newestTs);
    logger.info({ action: 'slack_mentions_fetched', count: messages.length }, 'Slack mentions fetched');
  } catch (err) {
    logger.error({ action: 'slack_mentions_failed', err }, 'Failed to fetch Slack mentions — user token required for search');
  }

  // --- monitored channel root posts that should always become tasks ---
  if (includeMonitorThreads) try {
    await fetchMonitorChannelThreads(client, messages, sinceMs, cutoffMs, isBackfill);
  } catch (err) {
    logger.error({ action: 'slack_monitor_threads_failed', err }, 'Failed to fetch monitored Slack channel threads');
  }

  // --- DMs and group DMs ---
  if (includeDms) try {
    const lookbackFloor = Math.floor(sinceMs / 1000);
    const lookbackFloorStr = String(lookbackFloor);
    const excludeList = config.slack.dmExcludeList;
    const allChannels = await listAllDmConversations(client);
    const channels = fullDmSweep
      ? allChannels
      : await selectRecentChannels(
        client,
        allChannels,
        config.slack.dmDiscoveryLimit,
        config.slack.dmRecentWindowHours,
      );

    logger.info({
      action: 'slack_dm_scan_mode',
      mode: fullDmSweep ? 'full' : 'recent_activity_only',
      conversations: channels.length,
    }, 'Slack DM scan mode selected');

    for (const channel of channels) {
      if (!channel.id) continue;
      const channelId = channel.id;

      // Skip excluded DMs
      if (excludeList.length > 0) {
        let dmName = channel.name ?? '';
        if (channel.is_im && channel.user) {
          dmName = await resolveUser(client, channel.user);
        }
        const dmNameLower = dmName.toLowerCase();
        if (excludeList.some(excluded => dmNameLower.includes(excluded) || excluded === channelId.toLowerCase())) continue;
      }

      await sleep(HISTORY_DELAY_MS);

      try {
        const savedCursor = isBackfill ? undefined : getSlackCursor(channelId);
        const oldest = savedCursor && parseFloat(savedCursor) > lookbackFloor
          ? savedCursor
          : lookbackFloorStr;
        let newestTs: string | undefined;
        let historyCursor: string | undefined;

        do {
          const histResult = await client.conversations.history({
            channel: channelId,
            limit: 200,
            oldest,
            cursor: historyCursor,
          });

          for (const msg of histResult.messages ?? []) {
            const ts = msg.ts as string;
            if (!ts || !msg.text) continue;
            if (msg.subtype) continue;
            if (oldest && ts <= oldest) continue;
            if (cutoffMs && parseFloat(ts) * 1000 > cutoffMs) continue;

            const senderName = msg.user ? await resolveUser(client, msg.user) : 'Unknown';

            const label = channel.name ? `DM: ${channel.name}` : 'DM';
            messages.push({
              id: `dm_${channelId}_${ts}`,
              source: 'slack',
              receivedAt: new Date(parseFloat(ts) * 1000),
              senderName,
              channelOrFolder: label,
              content: msg.text as string,
              threadId: msg.thread_ts,
              conversationId: `slack_dm:${channelId}`,
              isFromSelf: msg.user === userId,
            });

            if (!newestTs || ts > newestTs) newestTs = ts;
          }

          historyCursor = histResult.response_metadata?.next_cursor || undefined;
        } while (historyCursor);

        if (newestTs && !isBackfill) setSlackCursor(channelId, newestTs);
      } catch (err) {
        logger.error({ action: 'slack_dm_failed', channelId, err }, 'Failed to fetch DM history');
      }
    }

    logger.info({ action: 'slack_dms_fetched', total: messages.length }, 'Slack DMs fetched');
  } catch (err) {
    logger.error({ action: 'slack_dms_list_failed', err }, 'Failed to list DM conversations');
  }

  return messages;
}

async function listAllDmConversations(client: WebClient): Promise<SlackConversation[]> {
  const channels: SlackConversation[] = [];
  let conversationsCursor: string | undefined;

  do {
    const convResult = await client.conversations.list({
      types: 'im,mpim',
      limit: 200,
      exclude_archived: true,
      cursor: conversationsCursor,
    });

    channels.push(...((convResult.channels ?? []) as SlackConversation[]));
    conversationsCursor = convResult.response_metadata?.next_cursor || undefined;
  } while (conversationsCursor);

  return channels;
}

async function selectRecentChannels(
  client: WebClient,
  allChannels: SlackConversation[],
  scanLimit: number,
  recentWindowHours: number,
): Promise<SlackConversation[]> {
  const recentThresholdSeconds = (Date.now() - recentWindowHours * 60 * 60 * 1000) / 1000;
  const hydratedChannels = await hydratePriorityDirectMessages(client, allChannels, scanLimit);
  const recentChannels = hydratedChannels
    .filter(channel => channel.id)
    .filter(channel => getConversationRecencyScore(channel) >= recentThresholdSeconds)
    .sort((a, b) => getConversationRecencyScore(b) - getConversationRecencyScore(a));

  if (recentChannels.length === 0 || scanLimit <= 0) {
    logger.info({
      action: 'slack_dm_recent_selection',
      totalConversations: allChannels.length,
      recentConversations: recentChannels.length,
      scanLimit,
      recentWindowHours,
    }, 'Slack DM recent-activity selection calculated');
    return [];
  }

  const selectedCount = Math.min(scanLimit, recentChannels.length);
  const selectedChannels = recentChannels.slice(0, selectedCount);

  logger.info({
    action: 'slack_dm_recent_selection',
    totalConversations: allChannels.length,
    recentConversations: recentChannels.length,
    selectedCount,
    recentWindowHours,
    mostRecentActivityTs: selectedChannels[0] ? getConversationRecencyScore(selectedChannels[0]) : undefined,
    selectedChannels: selectedChannels.map(channel => ({
      id: channel.id,
      name: channel.name,
      isIm: channel.is_im,
      updated: channel.updated,
      latestTs: channel.latest?.ts,
      priority: channel.priority,
    })),
  }, 'Slack DM recent-activity selection calculated');

  return selectedChannels;
}

async function hydratePriorityDirectMessages(
  client: WebClient,
  allChannels: SlackConversation[],
  scanLimit: number,
): Promise<SlackConversation[]> {
  const directImCandidates = allChannels
    .filter(channel => channel.id && channel.is_im)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, Math.max(scanLimit * 2, 10));

  const hydratedById = new Map<string, SlackConversation>();

  for (const channel of directImCandidates) {
    if (!channel.id) continue;
    try {
      const info = await client.conversations.info({ channel: channel.id });
      const hydrated = info.channel as SlackConversation | undefined;
      if (hydrated?.id) {
        hydratedById.set(hydrated.id, {
          ...channel,
          ...hydrated,
          latest: typeof hydrated.latest === 'object' ? hydrated.latest : channel.latest,
        });
      }
    } catch (err) {
      logger.warn({ action: 'slack_dm_info_failed', channelId: channel.id, err }, 'Failed to hydrate direct DM info');
    }
  }

  logger.info({
    action: 'slack_dm_info_hydration',
    hydratedCount: hydratedById.size,
    candidateCount: directImCandidates.length,
  }, 'Slack direct DM info hydration complete');

  return allChannels.map(channel => {
    if (!channel.id) return channel;
    return hydratedById.get(channel.id) ?? channel;
  });
}

function getConversationRecencyScore(channel: SlackConversation): number {
  const latestTs = channel.latest?.ts ? Number.parseFloat(channel.latest.ts) : Number.NaN;
  if (!Number.isNaN(latestTs)) return latestTs;
  if (typeof channel.updated === 'number') return normalizeSlackTimestamp(channel.updated);
  return 0;
}

function normalizeSlackTimestamp(value: number): number {
  return value > 1e12 ? value / 1000 : value;
}

async function fetchMonitorChannelThreads(
  client: WebClient,
  messages: RawMessage[],
  sinceMs?: number,
  cutoffMs?: number,
  isBackfill = false,
): Promise<void> {
  for (const channelName of config.slack.monitorThreadChannels) {
    const channelId = await resolveChannelIdByName(client, channelName);
    if (channelId) {
      await fetchMonitorChannelThreadsFromHistory(client, messages, channelName, channelId, sinceMs, cutoffMs, isBackfill);
      continue;
    }

    logger.warn({
      action: 'slack_monitor_channel_resolve_failed',
      channel: channelName,
    }, 'Could not resolve monitor channel ID — falling back to Slack search');

    await fetchMonitorChannelThreadsViaSearch(client, messages, channelName, sinceMs, cutoffMs, isBackfill);
  }
}

async function resolveChannelIdByName(client: WebClient, channelName: string): Promise<string | undefined> {
  const cached = channelIdCache.get(channelName);
  if (cached) return cached;

  let cursor: string | undefined;
  do {
    const result = await client.conversations.list({
      types: 'public_channel',
      limit: 200,
      exclude_archived: true,
      cursor,
    });

    const match = ((result.channels ?? []) as SlackConversation[])
      .find(channel => channel.name?.toLowerCase() === channelName.toLowerCase());

    if (match?.id) {
      channelIdCache.set(channelName, match.id);
      return match.id;
    }

    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return undefined;
}

async function fetchMonitorChannelThreadsFromHistory(
  client: WebClient,
  messages: RawMessage[],
  channelName: string,
  channelId: string,
  sinceMs?: number,
  cutoffMs?: number,
  isBackfill = false,
): Promise<void> {
  const cursorKey = `${MONITOR_THREAD_CURSOR_PREFIX}${channelName}`;
  const savedCursor = isBackfill ? undefined : getSlackCursor(cursorKey);
  const rollingFloorTs = String(Math.floor((Date.now() - config.ingestion.maxCatchupDays * DAY_MS) / 1000));
  const initialLookbackTs = String(Math.floor((Date.now() - DAY_MS) / 1000));
  const oldest = isBackfill
    ? String(Math.floor((sinceMs ?? Date.now() - DAY_MS) / 1000))
    : savedCursor
      ? (parseFloat(savedCursor) > parseFloat(rollingFloorTs) ? savedCursor : rollingFloorTs)
      : initialLookbackTs;
  const latest = cutoffMs ? String(Math.floor(cutoffMs / 1000)) : undefined;
  let newestTs: string | undefined;
  let historyCursor: string | undefined;
  let channelCount = 0;

  do {
    const result = await client.conversations.history({
      channel: channelId,
      limit: 200,
      ...(oldest ? { oldest } : {}),
      ...(latest ? { latest } : {}),
      cursor: historyCursor,
    });

    for (const message of (result.messages ?? []) as SlackHistoryMessage[]) {
      const ts = message.ts;
      const text = message.text?.trim();
      if (!ts || !text) continue;
      if (message.subtype && ['bot_add', 'channel_join'].includes(message.subtype)) continue;

      const threadTs = message.thread_ts;
      const isRootMessage = !threadTs || threadTs === ts;
      if (!isRootMessage) continue;

      if (savedCursor && ts <= savedCursor) continue;
      if (sinceMs && parseFloat(ts) * 1000 < sinceMs) continue;
      if (cutoffMs && parseFloat(ts) * 1000 > cutoffMs) continue;

      const senderName = message.username
        ? message.username
        : message.user
          ? await resolveUser(client, message.user)
          : channelName.replace(/[_-]+/g, ' ');
      const rawSummary = text.trim();
      const normalizedSummary = rawSummary.replace(/\s+/g, ' ').trim();

      messages.push({
        id: `monitor_${channelName}_${ts}`,
        source: 'slack',
        receivedAt: new Date(parseFloat(ts) * 1000),
        senderName,
        channelOrFolder: `#${channelName}`,
        content: text,
        permalink: await getSlackPermalink(client, channelId, ts),
        threadId: ts,
        conversationId: `slack_monitor:${channelId}`,
        automation: {
          type: 'slack_monitor_thread',
          actionTitle: buildMonitorThreadActionTitle(`#${channelName}`, rawSummary),
          requestedBy: senderName,
          originalSnippet: normalizedSummary.slice(0, 300),
          dueDateTime: new Date(parseFloat(ts) * 1000 + 24 * 60 * 60 * 1000).toISOString(),
          urgent: true,
          ruleNote: `Auto-created from a new root post in #${channelName}`,
        },
      });

      channelCount += 1;
      if (!newestTs || ts > newestTs) newestTs = ts;
    }

    historyCursor = result.response_metadata?.next_cursor || undefined;
  } while (historyCursor);

  if (newestTs && !isBackfill) setSlackCursor(cursorKey, newestTs);
  logger.info({
    action: 'slack_monitored_threads_fetched',
    channel: channelName,
    count: channelCount,
  }, 'Slack monitored channel threads fetched');
}

async function fetchMonitorChannelThreadsViaSearch(
  client: WebClient,
  messages: RawMessage[],
  channelName: string,
  sinceMs?: number,
  cutoffMs?: number,
  isBackfill = false,
): Promise<void> {
  const cursorKey = `${MONITOR_THREAD_CURSOR_PREFIX}${channelName}`;
  const savedCursor = isBackfill ? undefined : getSlackCursor(cursorKey);
  const rollingFloorMs = Date.now() - config.ingestion.maxCatchupDays * DAY_MS;
  const initialLookbackMs = Date.now() - DAY_MS;
  let newestTs: string | undefined;
  let page = 1;
  let hasMorePages = true;
  let channelCount = 0;
  const hydratedMessages = new Map<string, SlackHistoryMessage | null>();

  while (hasMorePages) {
    const result = await client.search.messages({
      query: `in:${channelName}`,
      sort: 'timestamp',
      sort_dir: 'desc',
      count: 100,
      page,
    });

    const matches = (result.messages?.matches ?? []) as SlackSearchMatch[];
    if (matches.length === 0) break;

    let sawOlderThanCursor = false;

    for (const match of matches) {
      const ts = match.ts;
      if (!ts) continue;

      const messageDetails = await resolveMonitorMessage(client, match, hydratedMessages);
      const text = messageDetails.text;
      if (!text) continue;
      if (messageDetails.subtype && ['bot_add', 'channel_join'].includes(messageDetails.subtype)) continue;

      const threadTs = messageDetails.threadTs;
      const isRootMessage = !threadTs || threadTs === ts;
      if (!isRootMessage) continue;

      if (savedCursor && ts <= savedCursor) {
        sawOlderThanCursor = true;
        continue;
      }

      const tsMs = parseFloat(ts) * 1000;
      const floorMs = isBackfill
        ? (sinceMs ?? Date.now() - DAY_MS)
        : savedCursor
          ? Math.max(parseFloat(savedCursor) * 1000, rollingFloorMs)
          : initialLookbackMs;

      if (tsMs < floorMs) {
        sawOlderThanCursor = true;
        continue;
      }
      if (cutoffMs && tsMs > cutoffMs) continue;

      const senderName = messageDetails.senderName;
      const channelLabel = match.channel?.name ? `#${match.channel.name}` : `#${channelName}`;
      const summary = text.replace(/\s+/g, ' ').trim();

      messages.push({
        id: `monitor_${channelName}_${ts}`,
        source: 'slack',
        receivedAt: new Date(tsMs),
        senderName,
        channelOrFolder: channelLabel,
        content: text,
        permalink: typeof match.permalink === 'string' ? match.permalink : undefined,
        threadId: ts,
        conversationId: match.channel?.id ? `slack_monitor:${match.channel.id}` : `slack_monitor:${channelName}`,
        automation: {
          type: 'slack_monitor_thread',
          actionTitle: buildMonitorThreadActionTitle(channelLabel, summary),
          requestedBy: senderName,
          originalSnippet: summary.slice(0, 300),
          dueDateTime: new Date(tsMs + DAY_MS).toISOString(),
          urgent: true,
          ruleNote: `Auto-created from a new root post in ${channelLabel}`,
        },
      });

      channelCount += 1;
      if (!newestTs || ts > newestTs) newestTs = ts;
    }

    const totalPages = result.messages?.paging?.pages ?? page;
    hasMorePages = page < totalPages && !sawOlderThanCursor;
    page += 1;
  }

  if (newestTs && !isBackfill) setSlackCursor(cursorKey, newestTs);
  logger.info({
    action: 'slack_monitored_threads_fetched',
    channel: channelName,
    count: channelCount,
  }, 'Slack monitored channel threads fetched');
}

async function getSlackPermalink(
  client: WebClient,
  channelId: string,
  ts: string,
): Promise<string | undefined> {
  try {
    const result = await client.chat.getPermalink({ channel: channelId, message_ts: ts });
    return typeof result.permalink === 'string' ? result.permalink : undefined;
  } catch {
    return undefined;
  }
}

function buildMonitorThreadActionTitle(channelLabel: string, summary: string): string {
  const headline = extractMonitorHeadline(summary);
  if (!headline) return `Review new ${channelLabel} thread`;
  return headline.length > 80 ? `${headline.slice(0, 77).trimEnd()}...` : headline;
}

function extractMonitorHeadline(summary: string): string {
  const firstNonEmptyLine = summary
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) ?? '';
  const normalized = firstNonEmptyLine.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const withoutLeadingEmoji = normalized
    .replace(/^:?[a-z0-9_+\-]+:?\s+/i, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();

  for (const marker of [' A new version has been created', ' Review in GTM']) {
    const idx = withoutLeadingEmoji.indexOf(marker);
    if (idx > 0) {
      return withoutLeadingEmoji.slice(0, idx).trim();
    }
  }

  const headerMatch = withoutLeadingEmoji.match(
    /^(?<headline>.+?)\s+\*Workspace:\*|\s+\*First Seen:\*|\s+\*Changes:\*|\s+\*Note:\*/u,
  );

  if (headerMatch?.groups?.headline) {
    return headerMatch.groups.headline.trim();
  }

  return withoutLeadingEmoji;
}

async function resolveMonitorMessage(
  client: WebClient,
  match: SlackSearchMatch,
  hydratedMessages: Map<string, SlackHistoryMessage | null>,
): Promise<{ text: string; threadTs?: string; senderName: string; subtype?: string }> {
  const fallbackText = typeof match.text === 'string' ? match.text : '';
  const fallbackThreadTs = typeof match.thread_ts === 'string' ? match.thread_ts : undefined;
  const channelId = match.channel?.id;
  const ts = match.ts;
  let hydrated = channelId && ts ? hydratedMessages.get(`${channelId}:${ts}`) : undefined;

  if (hydrated === undefined && channelId && ts && !fallbackText) {
    hydrated = await fetchMessageByTimestamp(client, channelId, ts);
    hydratedMessages.set(`${channelId}:${ts}`, hydrated);
  }

  const text = (hydrated?.text ?? fallbackText).trim();
  const threadTs = hydrated?.thread_ts ?? fallbackThreadTs;
  const subtype = hydrated?.subtype ?? (typeof match.subtype === 'string' ? match.subtype : undefined);
  const senderName = hydrated?.username
    ? hydrated.username
    : hydrated?.user
      ? await resolveUser(client, hydrated.user)
      : match.username
        ? String(match.username)
        : match.user
          ? await resolveUser(client, String(match.user))
          : 'Unknown';

  return { text, threadTs, senderName, subtype };
}

async function fetchMessageByTimestamp(
  client: WebClient,
  channelId: string,
  ts: string,
): Promise<SlackHistoryMessage | null> {
  try {
    const result = await client.conversations.history({
      channel: channelId,
      latest: ts,
      oldest: ts,
      inclusive: true,
      limit: 1,
    });

    const message = (result.messages?.[0] ?? null) as SlackHistoryMessage | null;
    return message?.ts === ts ? message : null;
  } catch (err) {
    logger.warn({ action: 'slack_monitor_message_hydrate_failed', channelId, ts, err }, 'Failed to hydrate Slack monitor message');
    return null;
  }
}
