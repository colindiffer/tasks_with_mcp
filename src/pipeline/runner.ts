import { fetchNewMessages as fetchSlack } from '../ingestion/slack.js';
import { fetchNewMessages as fetchOutlook } from '../ingestion/outlook.js';
import { fetchNewMeetings as fetchFathom } from '../ingestion/fathom.js';
import { classify } from '../classification/classifier.js';
import { check as dedupCheck, invalidateCache } from '../dedup/deduplicator.js';
import { createCard } from '../trello/client.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { RawMessage, TaskCandidate } from '../types/index.js';

function buildCardDescription(candidate: TaskCandidate): string {
  const { raw, classification } = candidate;
  const source = raw.source === 'slack' ? `Slack — ${raw.channelOrFolder ?? ''}` :
    raw.source === 'outlook' ? `Email — ${raw.channelOrFolder ?? 'Inbox'}` : 'Meeting (Fathom)';

  const confidenceBadge = classification.confidence === 'medium' ? '⚠️ Medium confidence — review before acting' : '';

  return [
    `**Source:** ${source}`,
    `**Requested by:** ${classification.requestedBy}`,
    `**Confidence:** ${classification.confidence.charAt(0).toUpperCase() + classification.confidence.slice(1)}`,
    `**Received:** ${raw.receivedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`,
    '',
    confidenceBadge,
    '',
    `**Original message:**`,
    `> ${classification.originalSnippet}`,
    '',
    raw.permalink ? `**Link:** ${raw.permalink}` : '',
    '',
    '---',
    '_Auto-captured by tasks\\_with\\_mcp_',
  ].filter(line => line !== undefined).join('\n');
}

async function processMessages(messages: RawMessage[]): Promise<void> {
  for (const msg of messages) {
    const result = await classify(msg);

    if (!result.isTask || result.confidence === 'low') {
      logger.warn({
        action: 'classification_skip',
        source: msg.source,
        messageId: msg.id,
        confidence: result.confidence,
        reasoning: result.reasoning,
      }, 'Message skipped — not a task or low confidence');
      continue;
    }

    const candidate: TaskCandidate = { raw: msg, classification: result };
    const dedup = await dedupCheck(candidate);

    if (dedup.decision === 'skip') continue;

    const card = await createCard({
      name: result.actionTitle,
      desc: buildCardDescription(candidate),
      idList: config.trello.intakeListId,
      ...(result.dueDate ? { due: result.dueDate } : {}),
    });

    logger.info({
      action: 'card_created',
      source: msg.source,
      messageId: msg.id,
      cardId: card.id,
      confidence: result.confidence,
      title: result.actionTitle,
    }, 'Trello card created');
  }
}

export async function run(): Promise<void> {
  logger.info({ action: 'run_start' }, 'Pipeline run started');
  invalidateCache();

  const sources: Array<{ name: string; fetch: () => Promise<RawMessage[]> | RawMessage[] }> = [
    { name: 'slack', fetch: fetchSlack },
    { name: 'outlook', fetch: fetchOutlook },
    { name: 'fathom', fetch: fetchFathom },
  ];

  for (const source of sources) {
    try {
      const messages = await source.fetch();
      await processMessages(messages);
    } catch (err) {
      logger.error({ action: 'source_failed', source: source.name, err }, `${source.name} ingestion failed`);
    }
  }

  logger.info({ action: 'run_complete' }, 'Pipeline run complete');
}
