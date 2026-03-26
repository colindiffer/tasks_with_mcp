import type { TaskCandidate } from '../types/index.js';

export interface FieldMatchResult {
  client?: string;
  requestType?: string;
}

const CLIENT_KEYWORDS: Array<{ option: string; patterns: string[] }> = [
  { option: 'BMS', patterns: ['bms'] },
  { option: 'CV Villas', patterns: ['cv villas'] },
  { option: 'Dogs Trust', patterns: ['dogs trust'] },
  { option: 'Explore', patterns: ['explore'] },
  { option: 'Hotel Plan (Santa)', patterns: ['santa', 'hotel plan santa'] },
  { option: 'Hotel Plan (Inghams)', patterns: ['inghams', 'hotel plan inghams'] },
  { option: 'iCandy', patterns: ['icandy', 'i-candy'] },
  { option: 'Kuoni', patterns: ['kuoni'] },
  { option: 'LLG', patterns: ['llg'] },
  { option: 'Panasonic', patterns: ['panasonic'] },
  { option: 'Pour Moi', patterns: ['pour moi', 'pourmoi'] },
  { option: 'Propellernet', patterns: ['propellernet'] },
  { option: 'Spa Seekers', patterns: ['spa seekers', 'spaseekers'] },
  { option: 'SportsShoes.com', patterns: ['sportsshoes', 'sports shoes'] },
];

const REQUEST_TYPE_KEYWORDS: Array<{ option: string; patterns: string[] }> = [
  { option: 'Consent Mode', patterns: ['consent mode', 'consent signal', 'cmp', 'cookie consent'] },
  { option: 'Cookies', patterns: ['cookie', 'cookies', 'spotify ads'] },
  { option: 'Data Layer Changes', patterns: ['data layer', 'datalayer'] },
  { option: 'GA4 Additions', patterns: ['ga4', 'google analytics 4', 'analytics event', 'measurement'] },
  { option: 'GTM Changes', patterns: ['gtm', 'tag manager', 'tagging', 'trigger', 'tag setup'] },
  { option: 'Internal Testing', patterns: ['test internally', 'internal testing', 'uat', 'qa', 'check implementation'] },
  { option: 'Investigate Issues', patterns: ['investigate', 'issue', 'bug', 'firing incorrectly', 'not working', 'problem', 'error'] },
  { option: 'Migration', patterns: ['migration', 'migrate', 'move over', 'switch over'] },
  { option: 'New Paid Tasks', patterns: ['paid social', 'google ads', 'meta ads', 'bing ads', 'microsoft ads', 'campaign build'] },
];

function scorePatterns(text: string, patterns: string[]): number {
  return patterns.reduce((score, pattern) => score + (text.includes(pattern) ? 1 : 0), 0);
}

function bestMatch(
  text: string,
  options: Array<{ option: string; patterns: string[] }>
): string | undefined {
  let best: { option: string; score: number } | undefined;

  for (const entry of options) {
    const score = scorePatterns(text, entry.patterns);
    if (score === 0) continue;
    if (!best || score > best.score) best = { option: entry.option, score };
  }

  return best?.option;
}

export function matchFields(candidate: TaskCandidate): FieldMatchResult {
  const text = [
    candidate.classification.actionTitle,
    candidate.classification.originalSnippet,
    candidate.raw.content,
    candidate.raw.senderName,
    candidate.raw.senderEmail ?? '',
  ].join('\n').toLowerCase();

  return {
    client: bestMatch(text, CLIENT_KEYWORDS),
    requestType: bestMatch(text, REQUEST_TYPE_KEYWORDS),
  };
}
