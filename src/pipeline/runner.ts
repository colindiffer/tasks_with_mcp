import { fetchNewMessages as fetchSlack } from '../ingestion/slack.js';
import { fetchNewMessages as fetchOutlook } from '../ingestion/outlook.js';
import { fetchNewMessagesWithOptions as fetchTeams } from '../ingestion/teams.js';
import { classify } from '../classification/classifier.js';
import { check as dedupCheck, invalidateCache } from '../dedup/deduplicator.js';
import { loadFeedbackRules, matchesNegativeFeedback } from '../feedback/rules.js';
import { createCard } from '../trello/client.js';
import { matchFields } from '../trello/field-matcher.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { ClassificationResult, RawMessage, TaskCandidate } from '../types/index.js';

type RunSource = 'slack' | 'outlook' | 'teams';

interface RunOptions {
  slackFullDmSweep?: boolean;
  teamsFullSweep?: boolean;
  sources?: RunSource[];
  slackOptions?: {
    includeMentions?: boolean;
    includeMonitorThreads?: boolean;
    includeDms?: boolean;
  };
}

const SLACK_CONVERSATION_WINDOW_MS = 3 * 60 * 60 * 1000;

function buildCardTitle(candidate: TaskCandidate): string {
  const prefix = candidate.raw.source === 'slack'
    ? 'Slack'
    : candidate.raw.source === 'outlook'
      ? 'Email'
      : candidate.raw.source === 'teams'
        ? 'Teams'
      : 'Meeting';

  const baseTitle = `${prefix}: ${candidate.classification.actionTitle}`;
  return candidate.raw.automation?.urgent ? `URGENT: ${baseTitle}` : baseTitle;
}

function buildCardDescription(candidate: TaskCandidate): string {
  const { raw, classification } = candidate;
  const fieldMatch = matchFields(candidate);
  const source = raw.source === 'slack' ? `Slack — ${raw.channelOrFolder ?? ''}` :
    raw.source === 'outlook' ? `Email — ${raw.channelOrFolder ?? 'Inbox'}` :
      `Teams — ${raw.channelOrFolder ?? 'Chat'}`;

  const confidenceBadge = classification.confidence === 'medium' ? '⚠️ Medium confidence — review before acting' : '';
  const urgentBadge = raw.automation?.urgent ? 'Urgent monitor task - due within 24 hours' : '';

  return [
    `**Source:** ${source}`,
    `**Requested by:** ${classification.requestedBy}`,
    `**Personal:** ${classification.isPersonal ? 'Yes' : 'No'}`,
    `**Confidence:** ${classification.confidence.charAt(0).toUpperCase() + classification.confidence.slice(1)}`,
    raw.automation?.urgent ? '**Priority:** Urgent' : '',
    fieldMatch.client ? `**Client:** ${fieldMatch.client}` : '',
    fieldMatch.requestType ? `**Request Type:** ${fieldMatch.requestType}` : '',
    `**Received:** ${raw.receivedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`,
    '',
    urgentBadge,
    confidenceBadge,
    raw.automation?.ruleNote ? `**Rule:** ${raw.automation.ruleNote}` : '',
    '',
    `**Original message:**`,
    `> ${classification.originalSnippet}`,
    '',
    raw.permalink ? `**Link:** ${raw.permalink}` : '',
    '',
    '---',
    `<!-- source-id:${raw.id} -->`,
    '_Auto-captured by CPA_',
  ].filter(line => line !== undefined).join('\n');
}

async function getClassification(msg: RawMessage): Promise<ClassificationResult> {
  if (msg.automation?.type === 'slack_monitor_thread') {
    return {
      isTask: true,
      isPersonal: false,
      confidence: 'high',
      actionTitle: msg.automation.actionTitle,
      requestedBy: msg.automation.requestedBy,
      originalSnippet: msg.automation.originalSnippet,
      dueDate: msg.automation.dueDateTime,
      reasoning: msg.automation.ruleNote,
    };
  }

  return classify(msg);
}

function normaliseSender(value: string): string {
  return value.trim().toLowerCase();
}

function buildSlackConversationBucket(msg: RawMessage): string | undefined {
  if (msg.source !== 'slack' || msg.automation) return undefined;
  if (msg.threadId && msg.conversationId) return `${msg.conversationId}::thread:${msg.threadId}`;
  return msg.conversationId ?? msg.threadId;
}

function mergeSlackMessages(messages: RawMessage[]): RawMessage {
  const sorted = [...messages].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const latest = sorted[sorted.length - 1]!;
  const transcript = sorted
    .map(message => `[${message.receivedAt.toISOString()}] ${message.senderName}: ${message.content.trim()}`)
    .join('\n\n');

  return {
    ...latest,
    id: sorted.map(message => message.id).join('|'),
    content: transcript,
  };
}

function collapseSlackConversations(messages: RawMessage[]): RawMessage[] {
  const output: RawMessage[] = [];
  const grouped = new Map<string, RawMessage[]>();

  for (const msg of [...messages].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())) {
    if (msg.source !== 'slack' || msg.automation) {
      if (!msg.isFromSelf) output.push(msg);
      continue;
    }

    const bucket = buildSlackConversationBucket(msg);
    if (!bucket) {
      if (!msg.isFromSelf) output.push(msg);
      continue;
    }

    const existing = grouped.get(bucket);
    if (!existing) {
      grouped.set(bucket, [msg]);
      continue;
    }

    const lastMessage = existing[existing.length - 1]!;
    const withinWindow = msg.receivedAt.getTime() - existing[0]!.receivedAt.getTime() <= SLACK_CONVERSATION_WINDOW_MS;

    if (!withinWindow) {
      output.push(...finaliseSlackConversation(existing));
      grouped.set(bucket, [msg]);
      continue;
    }

    if (msg.receivedAt.getTime() < lastMessage.receivedAt.getTime()) {
      existing.splice(0, 0, msg);
    } else {
      existing.push(msg);
    }
  }

  for (const group of grouped.values()) {
    output.push(...finaliseSlackConversation(group));
  }

  return output.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}

function finaliseSlackConversation(group: RawMessage[]): RawMessage[] {
  const externalMessages = group.filter(message => !message.isFromSelf);
  if (externalMessages.length === 0) return [];
  if (externalMessages.length === 1) return externalMessages;

  const senderKeys = new Set(externalMessages.map(message => normaliseSender(message.senderName)));
  if (senderKeys.size > 1) return externalMessages;

  return [mergeSlackMessages(externalMessages)];
}

async function processMessages(messages: RawMessage[], feedbackRules: Awaited<ReturnType<typeof loadFeedbackRules>>): Promise<void> {
  for (const msg of collapseSlackConversations(messages)) {
    const result = await getClassification(msg);

    if (result.isPersonal) {
      logger.info({
        action: 'classification_skip_personal',
        source: msg.source,
        messageId: msg.id,
        confidence: result.confidence,
        reasoning: result.reasoning,
      }, 'Message skipped — personal or social conversation');
      continue;
    }

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
    const feedbackMatch = matchesNegativeFeedback(candidate, feedbackRules);
    if (feedbackMatch) {
      logger.warn({
        action: 'feedback_skip',
        source: msg.source,
        messageId: msg.id,
        issue: feedbackMatch.issue,
        matchedTitle: feedbackMatch.title,
      }, 'Message skipped due to AI Feedback rule');
      continue;
    }

    const dedup = await dedupCheck(candidate);
    const fieldMatch = matchFields(candidate);

    if (dedup.decision === 'skip') continue;

    const card = await createCard({
      name: buildCardTitle(candidate),
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
      title: buildCardTitle(candidate),
      client: fieldMatch.client,
      requestType: fieldMatch.requestType,
    }, 'Trello card created');
  }
}

export async function run(options?: RunOptions): Promise<void> {
  logger.info({
    action: 'run_start',
    slackFullDmSweep: options?.slackFullDmSweep ?? false,
    teamsFullSweep: options?.teamsFullSweep ?? false,
    sources: options?.sources ?? ['slack', 'outlook', 'teams'],
  }, 'Pipeline run started');
  invalidateCache();
  const feedbackRules = await loadFeedbackRules();

  const sources: Array<{ name: string; fetch: () => Promise<RawMessage[]> | RawMessage[] }> = [
    {
      name: 'slack',
      fetch: () => fetchSlack({
        fullDmSweep: options?.slackFullDmSweep,
        includeMentions: options?.slackOptions?.includeMentions,
        includeMonitorThreads: options?.slackOptions?.includeMonitorThreads,
        includeDms: options?.slackOptions?.includeDms,
      }),
    },
    { name: 'outlook', fetch: fetchOutlook },
    { name: 'teams', fetch: () => fetchTeams({ fullSweep: options?.teamsFullSweep }) },
  ];

  const enabledSources = options?.sources ?? ['slack', 'outlook', 'teams'];

  for (const source of sources.filter(candidate => enabledSources.includes(candidate.name as RunSource))) {
    try {
      const messages = await source.fetch();
      await processMessages(messages, feedbackRules);
    } catch (err) {
      logger.error({ action: 'source_failed', source: source.name, err }, `${source.name} ingestion failed`);
    }
  }

  logger.info({ action: 'run_complete' }, 'Pipeline run complete');
}
