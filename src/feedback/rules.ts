import { config } from '../config/index.js';
import { getAmazingFieldsBoardConfig, getCardsInListWithPluginData } from '../trello/client.js';
import { decodeBoardConfig, decodeCardFieldValues } from './amazing-fields.js';
import { logger } from '../utils/logger.js';
import type { TaskCandidate } from '../types/index.js';

export interface FeedbackRule {
  issue: string;
  title: string;
  snippet?: string;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordOverlapScore(a: string, b: string): number {
  const wordsA = new Set(a.split(' ').filter(word => word.length > 3));
  const wordsB = new Set(b.split(' ').filter(word => word.length > 3));
  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }
  const denom = Math.max(wordsA.size, wordsB.size);
  return denom === 0 ? 0 : overlap / denom;
}

function extractSnippet(desc: string): string | undefined {
  const match = desc.match(/\*\*Original message:\*\*\s*> ([\s\S]*?)(?:\n\n\*\*Link:\*\*|\n\n---|$)/);
  return match?.[1]?.replace(/\s+/g, ' ').trim();
}

function isNegativeIssue(issue: string): boolean {
  return ['spam', 'sales outreach', 'duplicate', 'should have been ignored'].includes(issue.toLowerCase());
}

export async function loadFeedbackRules(): Promise<FeedbackRule[]> {
  if (!config.trello.feedbackListId) return [];

  try {
    const boardPlugin = await getAmazingFieldsBoardConfig(config.trello.boardId);
    const boardConfig = decodeBoardConfig(boardPlugin?.value);
    const cards = await getCardsInListWithPluginData(config.trello.feedbackListId);

    const rules = cards.flatMap(card => {
      const pluginValue = card.pluginData.find(item => item.idPlugin === '60e068efb294647187bbe4f5')?.value;
      const fieldValues = decodeCardFieldValues(pluginValue, boardConfig);
      const issue = fieldValues['Issue'];
      if (!issue || !isNegativeIssue(issue)) return [];

      return [{
        issue,
        title: card.name,
        snippet: extractSnippet(card.desc),
      }];
    });

    logger.info({ action: 'feedback_rules_loaded', count: rules.length }, 'Feedback rules loaded');
    return rules;
  } catch (err) {
    logger.warn({ err }, 'Failed to load feedback rules');
    return [];
  }
}

export function matchesNegativeFeedback(candidate: TaskCandidate, rules: FeedbackRule[]): FeedbackRule | undefined {
  const title = normalise(candidate.classification.actionTitle);
  const snippet = normalise(candidate.classification.originalSnippet);

  return rules.find(rule => {
    const ruleTitle = normalise(rule.title);
    const ruleSnippet = normalise(rule.snippet ?? '');

    const titleScore = wordOverlapScore(title, ruleTitle);
    const snippetScore = ruleSnippet && snippet
      ? wordOverlapScore(snippet, ruleSnippet)
      : 0;

    return titleScore >= 0.6 || snippetScore >= 0.5;
  });
}
