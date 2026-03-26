import { getCardsInList } from '../trello/client.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { TaskCandidate, DedupResult, TrelloCard } from '../types/index.js';

// Normalise a string for comparison: lowercase, strip punctuation, collapse whitespace
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Count overlapping words between two normalised strings
function wordOverlapScore(a: string, b: string): number {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 3));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 3));
  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }
  const denom = Math.max(wordsA.size, wordsB.size);
  return denom === 0 ? 0 : overlap / denom;
}

const SIMILARITY_THRESHOLD = 0.6;
const SNIPPET_SIMILARITY_THRESHOLD = 0.5;

let cachedCards: TrelloCard[] | null = null;
let cacheExpiry = 0;

async function getOpenCards(): Promise<TrelloCard[]> {
  if (cachedCards && Date.now() < cacheExpiry) return cachedCards;
  cachedCards = await getCardsInList(config.trello.intakeListId);
  cacheExpiry = Date.now() + 5 * 60 * 1000; // cache for 5 minutes per run
  return cachedCards;
}

export function invalidateCache(): void {
  cachedCards = null;
  cacheExpiry = 0;
}

export function registerCreatedCard(card: TrelloCard): void {
  if (!cachedCards || Date.now() >= cacheExpiry) return;
  cachedCards = [card, ...cachedCards];
}

function findExactSourceDuplicate(candidate: TaskCandidate, existingCards: TrelloCard[]): TrelloCard | undefined {
  const sourceIdMarker = `source-id:${candidate.raw.id}`;
  const permalink = candidate.raw.permalink;

  return existingCards.find(card =>
    card.desc.includes(sourceIdMarker) ||
    Boolean(permalink && card.desc.includes(permalink))
  );
}

export async function check(candidate: TaskCandidate): Promise<DedupResult> {
  const candidateTitle = normalise(candidate.classification.actionTitle);
  const candidateSnippet = normalise(candidate.classification.originalSnippet);
  const isMonitorThread = candidate.raw.automation?.type === 'slack_monitor_thread';

  let existingCards: TrelloCard[];
  try {
    existingCards = await getOpenCards();
  } catch (err) {
    logger.warn({ err }, 'Could not fetch Trello cards for dedup — defaulting to create');
    return { decision: 'create' };
  }

  const exactMatch = findExactSourceDuplicate(candidate, existingCards);
  if (exactMatch) {
    logger.warn({
      action: 'dedup_skip',
      candidateTitle: candidate.classification.actionTitle,
      matchedCard: exactMatch.name,
      messageId: candidate.raw.id,
      matchedBy: 'source_identity',
    }, 'Duplicate task detected from the same source message — skipping card creation');
    return { decision: 'skip', matchedCardId: exactMatch.id, matchedCardName: exactMatch.name };
  }

  for (const card of existingCards) {
    if (isMonitorThread) {
      continue;
    }

    const titleScore = wordOverlapScore(candidateTitle, normalise(card.name));
    const snippetScore = candidateSnippet
      ? wordOverlapScore(candidateSnippet, normalise(card.desc))
      : 0;

    if (titleScore >= SIMILARITY_THRESHOLD || snippetScore >= SNIPPET_SIMILARITY_THRESHOLD) {
      logger.warn({
        action: 'dedup_skip',
        candidateTitle: candidate.classification.actionTitle,
        matchedCard: card.name,
        titleScore,
        snippetScore,
      }, 'Duplicate task detected — skipping card creation');
      return { decision: 'skip', matchedCardId: card.id, matchedCardName: card.name };
    }
  }

  return { decision: 'create' };
}
