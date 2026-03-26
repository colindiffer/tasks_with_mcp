import { config } from '../config/index.js';
import type { TrelloCard, TrelloCardPayload } from '../types/index.js';

const BASE = 'https://api.trello.com/1';

function authParams(): string {
  return `key=${config.trello.apiKey}&token=${config.trello.token}`;
}

async function trelloFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${path}${sep}${authParams()}`, options);
  if (!res.ok) throw new Error(`Trello API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function getCardsInList(listId: string): Promise<TrelloCard[]> {
  return trelloFetch<TrelloCard[]>(`/lists/${listId}/cards`);
}

export interface TrelloPluginDataItem {
  idPlugin: string;
  value: string;
}

export interface TrelloCardWithPluginData extends TrelloCard {
  pluginData: TrelloPluginDataItem[];
}

export interface TrelloBoardPluginData {
  idPlugin: string;
  value: string;
}

export async function getCardsInListWithPluginData(listId: string): Promise<TrelloCardWithPluginData[]> {
  return trelloFetch<TrelloCardWithPluginData[]>(`/lists/${listId}/cards?pluginData=true`);
}

export async function getAmazingFieldsBoardConfig(boardId: string): Promise<TrelloBoardPluginData | undefined> {
  const board = await trelloFetch<{ pluginData?: TrelloBoardPluginData[] }>(`/boards/${boardId}?pluginData=true`);
  return board.pluginData?.find(item => item.idPlugin === '60e068efb294647187bbe4f5');
}

export async function createCard(payload: TrelloCardPayload): Promise<TrelloCard> {
  const body = new URLSearchParams({
    name: payload.name,
    desc: payload.desc,
    idList: payload.idList,
    ...(payload.due ? { due: payload.due } : {}),
  });
  return trelloFetch<TrelloCard>('/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

export async function addCommentToCard(cardId: string, text: string): Promise<void> {
  const body = new URLSearchParams({ text });
  await trelloFetch(`/cards/${cardId}/actions/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}
