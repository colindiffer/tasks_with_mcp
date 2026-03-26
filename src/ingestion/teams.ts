import fetch from 'node-fetch';
import { config } from '../config/index.js';
import { getTeamsChatIds, getTeamsCursor, setTeamsCursor } from '../state/store.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { getGraphBase, getMicrosoftGraphAccessToken, isMicrosoftGraphConfigured } from './microsoft-graph.js';
import type { RawMessage } from '../types/index.js';

interface GraphUser {
  id: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
}

interface GraphChat {
  id: string;
  topic?: string;
  chatType?: string;
  lastUpdatedDateTime?: string;
  webUrl?: string;
}

interface GraphChatMessage {
  id: string;
  createdDateTime: string;
  lastModifiedDateTime?: string;
  messageType?: string;
  subject?: string;
  body?: { contentType?: string; content?: string };
  from?: {
    user?: {
      id?: string;
      displayName?: string;
      userIdentityType?: string;
    };
  };
  webUrl?: string;
}

interface GraphListResponse<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

function stripHtml(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/<at[^>]*>(.*?)<\/at>/gi, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGroupChat(chat: GraphChat): boolean {
  return chat.chatType === 'group' || chat.chatType === 'meeting';
}

export async function fetchNewMessages(): Promise<RawMessage[]> {
  return fetchNewMessagesWithOptions();
}

export async function fetchNewMessagesWithOptions(options?: { fullSweep?: boolean }): Promise<RawMessage[]> {
  if (!isMicrosoftGraphConfigured()) {
    logger.debug({ action: 'teams_skip' }, 'Microsoft Graph not configured — skipping Teams');
    return [];
  }

  const token = await getMicrosoftGraphAccessToken();
  const graphBase = getGraphBase();
  const sinceMs = config.backfill.since?.getTime();
  const cutoffMs = config.backfill.until?.getTime();
  const knownOnly = !(options?.fullSweep ?? Boolean(config.backfill.since)) && getTeamsChatIds().length > 0;
  const messages: RawMessage[] = [];

  const meRes = await withRetry(() =>
    fetch(`${graphBase}/me?$select=id,displayName,mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  );
  if (!meRes.ok) throw new Error(`Teams /me request failed: ${meRes.status} ${await meRes.text()}`);
  const me = await meRes.json() as GraphUser;

  const chats = knownOnly
    ? await getKnownChatsWithDiscovery(token, graphBase, sinceMs, cutoffMs)
    : await getChatsForScan(token, graphBase, sinceMs, cutoffMs);

  logger.info({
    action: 'teams_chat_scan_mode',
    mode: knownOnly ? 'known_only' : 'full',
    chats: chats.length,
  }, 'Teams chat scan mode selected');

  for (const chat of chats) {
    const savedCursor = getTeamsCursor(chat.id);
    const lowerBoundMs = Math.max(
      savedCursor ? new Date(savedCursor).getTime() : Number.NEGATIVE_INFINITY,
      sinceMs ?? Number.NEGATIVE_INFINITY,
    );

    let nextUrl: string | undefined =
      `${graphBase}/chats/${encodeURIComponent(chat.id)}/messages` +
      `?$top=50`;
    let newestMessageDate: string | undefined = savedCursor;

    while (nextUrl) {
      const res = await withRetry(() =>
        fetch(nextUrl!, { headers: { Authorization: `Bearer ${token}` } })
      );
      if (!res.ok) throw new Error(`Teams chat messages request failed: ${res.status} ${await res.text()}`);

      const data = await res.json() as GraphListResponse<GraphChatMessage>;

      for (const message of data.value) {
        const messageTs = new Date(message.createdDateTime).getTime();
        if (Number.isFinite(lowerBoundMs) && messageTs <= lowerBoundMs) {
          continue;
        }
        if (cutoffMs && messageTs > cutoffMs) continue;
        if (message.messageType && message.messageType !== 'message') continue;

        const sender = message.from?.user;
        if (!sender?.id || sender.id === me.id) continue;

        const bodyText = stripHtml(message.body?.content);
        if (!bodyText) continue;

        const contentPrefix = message.subject ? `Subject: ${message.subject}\n\n` : '';
        const chatLabel = isGroupChat(chat)
          ? `Teams Group Chat${chat.topic ? `: ${chat.topic}` : ''}`
          : `Teams Chat${chat.topic ? `: ${chat.topic}` : ''}`;

        messages.push({
          id: `teams_${chat.id}_${message.id}`,
          source: 'teams',
          receivedAt: new Date(message.createdDateTime),
          senderName: sender.displayName ?? 'Unknown',
          channelOrFolder: chatLabel,
          content: `${contentPrefix}${bodyText}`.slice(0, 4000),
          permalink: message.webUrl ?? chat.webUrl,
        });

        const candidateLatest = message.lastModifiedDateTime ?? message.createdDateTime;
        if (!newestMessageDate || candidateLatest > newestMessageDate) {
          newestMessageDate = candidateLatest;
        }
      }

      nextUrl = data['@odata.nextLink'];
    }

    if (newestMessageDate && newestMessageDate !== savedCursor) {
      setTeamsCursor(chat.id, newestMessageDate);
    }
  }

  logger.info({ action: 'teams_fetched', count: messages.length }, 'Teams chat messages fetched');
  return messages;
}

async function listAllChats(
  token: string,
  graphBase: string,
): Promise<GraphChat[]> {
  const chats: GraphChat[] = [];
  let nextUrl: string | undefined = `${graphBase}/me/chats?$top=50`;

  while (nextUrl) {
    const res = await withRetry(() =>
      fetch(nextUrl!, { headers: { Authorization: `Bearer ${token}` } })
    );
    if (!res.ok) throw new Error(`Teams chats request failed: ${res.status} ${await res.text()}`);

    const data = await res.json() as GraphListResponse<GraphChat>;
    chats.push(...data.value);
    nextUrl = data['@odata.nextLink'];
  }

  return chats;
}

async function getKnownChats(token: string, graphBase: string): Promise<GraphChat[]> {
  const chats: GraphChat[] = [];

  for (const chatId of getTeamsChatIds()) {
    try {
      const res = await withRetry(() =>
        fetch(`${graphBase}/chats/${encodeURIComponent(chatId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      );
      if (!res.ok) {
        logger.warn({ action: 'teams_chat_info_failed', chatId, status: res.status }, 'Failed to load known Teams chat');
        continue;
      }
      const chat = await res.json() as GraphChat;
      chats.push(chat);
    } catch (err) {
      logger.warn({ action: 'teams_chat_info_failed', chatId, err }, 'Failed to load known Teams chat');
    }
  }

  return chats;
}

async function getKnownChatsWithDiscovery(
  token: string,
  graphBase: string,
  sinceMs?: number,
  cutoffMs?: number,
): Promise<GraphChat[]> {
  const knownChats = await getKnownChats(token, graphBase);
  const discoveredChats = await getChatsForScan(token, graphBase, sinceMs, cutoffMs);
  const merged = new Map<string, GraphChat>();

  for (const chat of knownChats) {
    merged.set(chat.id, chat);
  }

  for (const chat of discoveredChats) {
    merged.set(chat.id, chat);
  }

  return [...merged.values()];
}

async function getChatsForScan(
  token: string,
  graphBase: string,
  sinceMs?: number,
  cutoffMs?: number,
): Promise<GraphChat[]> {
  const chats = await listAllChats(token, graphBase);
  const hydratedChats = await hydrateOneOnOneChatActivity(token, graphBase, chats);
  const filteredChats = filterChatsByUpdatedDate(hydratedChats, sinceMs, cutoffMs);

  logger.info({
    action: 'teams_chat_selection',
    totalChats: chats.length,
    hydratedChats: hydratedChats.filter(chat => chat.chatType === 'oneOnOne').length,
    selectedChats: filteredChats.length,
  }, 'Teams chat selection calculated');

  return filteredChats;
}

async function hydrateOneOnOneChatActivity(
  token: string,
  graphBase: string,
  chats: GraphChat[],
): Promise<GraphChat[]> {
  const hydrated = new Map<string, GraphChat>();

  for (const chat of chats) {
    if (chat.chatType !== 'oneOnOne') continue;
    try {
      const res = await withRetry(() =>
        fetch(`${graphBase}/chats/${encodeURIComponent(chat.id)}/messages?$top=1`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      );
      if (!res.ok) {
        logger.warn({ action: 'teams_chat_hydrate_failed', chatId: chat.id, status: res.status }, 'Failed to hydrate Teams one-on-one chat activity');
        continue;
      }

      const data = await res.json() as GraphListResponse<GraphChatMessage>;
      const latestMessage = data.value[0];
      const latestDateTime = latestMessage?.lastModifiedDateTime ?? latestMessage?.createdDateTime;

      if (latestDateTime) {
        hydrated.set(chat.id, {
          ...chat,
          lastUpdatedDateTime: latestDateTime,
        });
      }
    } catch (err) {
      logger.warn({ action: 'teams_chat_hydrate_failed', chatId: chat.id, err }, 'Failed to hydrate Teams one-on-one chat activity');
    }
  }

  return chats.map(chat => hydrated.get(chat.id) ?? chat);
}

function filterChatsByUpdatedDate(
  chats: GraphChat[],
  sinceMs?: number,
  cutoffMs?: number,
): GraphChat[] {
  return chats.filter(chat => {
    const updatedMs = chat.lastUpdatedDateTime ? new Date(chat.lastUpdatedDateTime).getTime() : undefined;
    if (sinceMs && updatedMs && updatedMs < sinceMs) return false;
    if (cutoffMs && updatedMs && updatedMs > cutoffMs) return false;
    return true;
  });
}
