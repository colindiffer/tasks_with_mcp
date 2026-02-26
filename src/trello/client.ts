import { withMcp } from '../mcp/clients.js';
import type { TrelloCard, TrelloCardPayload } from '../types/index.js';

export async function getCardsInList(listId: string): Promise<TrelloCard[]> {
  return withMcp('trello', async (call) => {
    return call('get_cards_by_list_id', { listId }) as Promise<TrelloCard[]>;
  });
}

export async function createCard(payload: TrelloCardPayload): Promise<TrelloCard> {
  return withMcp('trello', async (call) => {
    return call('add_card_to_list', {
      listId: payload.idList,
      name: payload.name,
      description: payload.desc,
      ...(payload.due ? { dueDate: payload.due } : {}),
    }) as Promise<TrelloCard>;
  });
}

export async function addCommentToCard(cardId: string, text: string): Promise<void> {
  await withMcp('trello', async (call) => {
    await call('add_comment', { cardId, text });
  });
}
