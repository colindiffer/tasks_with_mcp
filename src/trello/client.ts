import fetch from 'node-fetch';
import { config } from '../config/index.js';
import { withRetry } from '../utils/retry.js';
import type { TrelloCard, TrelloCardPayload } from '../types/index.js';

const BASE = 'https://api.trello.com/1';

function auth(): string {
  return `key=${config.trello.apiKey}&token=${config.trello.token}`;
}

export async function getCardsInList(listId: string): Promise<TrelloCard[]> {
  return withRetry(async () => {
    const res = await fetch(`${BASE}/lists/${listId}/cards?${auth()}&fields=id,name,desc,due,url`);
    if (!res.ok) throw new Error(`Trello getCards failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<TrelloCard[]>;
  });
}

export async function createCard(payload: TrelloCardPayload): Promise<TrelloCard> {
  return withRetry(async () => {
    const body = new URLSearchParams({
      idList: payload.idList,
      name: payload.name,
      desc: payload.desc,
      ...(payload.due ? { due: payload.due } : {}),
    });

    const res = await fetch(`${BASE}/cards?${auth()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Trello createCard failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<TrelloCard>;
  });
}

export async function addCommentToCard(cardId: string, text: string): Promise<void> {
  return withRetry(async () => {
    const res = await fetch(`${BASE}/cards/${cardId}/actions/comments?${auth()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ text }).toString(),
    });
    if (!res.ok) throw new Error(`Trello addComment failed: ${res.status} ${await res.text()}`);
  });
}
