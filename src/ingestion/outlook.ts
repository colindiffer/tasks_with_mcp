import fetch from 'node-fetch';
import { config } from '../config/index.js';
import { getOutlookCursor, hasStoredState, setOutlookCursor } from '../state/store.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { getGraphBase, getMicrosoftGraphAccessToken, isMicrosoftGraphConfigured } from './microsoft-graph.js';
import type { RawMessage } from '../types/index.js';

interface GraphMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  receivedDateTime: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  webLink: string;
}

interface GraphResponse {
  value: GraphMessage[];
  '@odata.nextLink'?: string;
}

const SENDER_BLOCKLIST = new Set([
  'comments-noreply@docs.google.com',
  'drive-shares-noreply@google.com',
  'no-reply@notify.microsoft.com',
]);

const SENDER_NAME_BLOCKLIST = new Set([
  'bing ads service',
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_USER_EMAIL = 'colin@propellernet.co.uk';

function getTargetUserEmail(): string {
  return (config.outlook.userEmail || DEFAULT_USER_EMAIL).trim().toLowerCase();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlToTextPreservingStructure(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)\b[^>]*>/gi, '\n')
      .replace(/<(p|div|li|tr|h\d)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normaliseSectionLabel(line: string): string {
  return line
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSelfIdentifiers(): string[] {
  const email = getTargetUserEmail();
  const localPart = email.split('@')[0] ?? '';
  const pieces = localPart.split(/[.\-_]+/).filter(Boolean);

  return Array.from(new Set([
    email,
    localPart,
    pieces.join(' '),
    pieces[0] ?? '',
    'colin differ',
    'colin',
  ].map(value => value.trim().toLowerCase()).filter(Boolean)));
}

function lineMatchesSelf(line: string, identifiers: string[]): boolean {
  const normalizedLine = line.toLowerCase();
  return identifiers.some(identifier => normalizedLine.includes(identifier));
}

function extractSection(lines: string[], startLabel: string, endLabels: string[]): string[] {
  const startIndex = lines.findIndex(line => normaliseSectionLabel(line).startsWith(startLabel));
  if (startIndex === -1) return [];

  const output: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    const normalized = normaliseSectionLabel(line);
    if (normalized && endLabels.some(endLabel => normalized.startsWith(endLabel))) break;
    output.push(line);
  }

  return output;
}

function formatFathomEmail(subject: string, bodyText: string): string {
  const lines = bodyText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const actionLines = extractSection(lines, 'action items', ['meeting summary', 'topics', 'next steps']);
  const summaryLines = extractSection(lines, 'meeting summary', ['topics', 'next steps']);
  const selfIdentifiers = buildSelfIdentifiers();

  const ownActionItems: string[] = [];
  const otherActionItems: string[] = [];

  for (let i = 0; i < actionLines.length; i += 1) {
    const taskLine = actionLines[i];
    if (!taskLine) continue;

    const assigneeLine = actionLines[i + 1];
    const normalizedTask = normaliseSectionLabel(taskLine);
    if (!normalizedTask || normalizedTask === 'action items') continue;

    if (assigneeLine && lineMatchesSelf(assigneeLine, selfIdentifiers)) {
      ownActionItems.push(taskLine);
      i += 1;
      continue;
    }

    if (assigneeLine && !['meeting summary', 'topics', 'next steps'].some(label => normaliseSectionLabel(assigneeLine).startsWith(label))) {
      otherActionItems.push(`${taskLine} [Owner: ${assigneeLine}]`);
      i += 1;
      continue;
    }

    otherActionItems.push(taskLine);
  }

  const summaryExcerpt = summaryLines.slice(0, 6).join('\n');

  return [
    `Subject: ${subject}`,
    'Source note: Fathom recap email',
    ownActionItems.length > 0 ? '' : 'No Colin-assigned action items detected in the structured block.',
    ownActionItems.length > 0 ? 'Action items assigned to Colin:' : '',
    ...ownActionItems.map(item => `- ${item}`),
    otherActionItems.length > 0 ? '' : '',
    otherActionItems.length > 0 ? 'Other action items in the recap:' : '',
    ...otherActionItems.slice(0, 5).map(item => `- ${item}`),
    summaryExcerpt ? '' : '',
    summaryExcerpt ? 'Meeting summary excerpt:' : '',
    summaryExcerpt,
  ].filter(Boolean).join('\n');
}

function formatOutlookContent(email: GraphMessage): string {
  const rawBody = email.body?.content ?? email.bodyPreview;
  const bodyText = email.body?.contentType === 'html'
    ? htmlToTextPreservingStructure(rawBody)
    : rawBody.replace(/\r/g, '').trim();

  const looksLikeFathom = /view meeting or ask fathom/i.test(bodyText) ||
    /^fathom$/im.test(bodyText) ||
    (/action items/i.test(bodyText) && /meeting summary/i.test(bodyText));

  if (looksLikeFathom) {
    return formatFathomEmail(email.subject, bodyText);
  }

  return `Subject: ${email.subject}\n\n${bodyText.slice(0, 2000)}`;
}

function collectRecipientAddresses(recipients: Array<{ emailAddress?: { address?: string } }> | undefined): string[] {
  return (recipients ?? [])
    .map(recipient => recipient.emailAddress?.address?.toLowerCase())
    .filter((address): address is string => Boolean(address));
}

export async function fetchNewMessages(): Promise<RawMessage[]> {
  if (!config.outlook.tenantId || !config.outlook.clientId || !process.env.OUTLOOK_REFRESH_TOKEN) {
    logger.debug({ action: 'outlook_skip' }, 'Outlook not configured — skipping');
    return [];
  }
  if (!isMicrosoftGraphConfigured()) {
    logger.debug({ action: 'outlook_skip' }, 'Microsoft Graph not configured — skipping Outlook');
    return [];
  }

  const cursorSince = getOutlookCursor();
  const hasState = hasStoredState();
  const firstRunFloorMs = Date.now() - config.ingestion.firstRunLookbackHours * HOUR_MS;
  const rollingFloorMs = Date.now() - config.ingestion.maxCatchupDays * DAY_MS;
  const effectiveSinceMs = config.backfill.since?.getTime() ?? rollingFloorMs;
  const cursorSinceMs = new Date(cursorSince).getTime();
  const baseSinceMs = Number.isFinite(cursorSinceMs)
    ? cursorSinceMs
    : hasState
      ? rollingFloorMs
      : Math.max(rollingFloorMs, firstRunFloorMs);
  const since = new Date(
    Math.max(
      baseSinceMs,
      effectiveSinceMs,
    ),
  ).toISOString();
  const messages: RawMessage[] = [];
  let newLatest: string | undefined;
  const cutoffIso = config.backfill.until?.toISOString();

  const token = await getMicrosoftGraphAccessToken();
  const graphBase = getGraphBase();

  const filter = cutoffIso
    ? `receivedDateTime gt ${since} and receivedDateTime le ${cutoffIso}`
    : `receivedDateTime gt ${since}`;
  let nextUrl: string | undefined = `${graphBase}/me/messages` +
    `?$filter=${encodeURIComponent(filter)}&$orderby=receivedDateTime asc&$top=50` +
    `&$select=id,subject,bodyPreview,body,receivedDateTime,from,toRecipients,ccRecipients,webLink`;

  while (nextUrl) {
    const res = await withRetry(() =>
      fetch(nextUrl!, { headers: { Authorization: `Bearer ${token}` } })
    );

    if (!res.ok) throw new Error(`Graph messages request failed: ${res.status} ${await res.text()}`);

    const data = await res.json() as GraphResponse;

    for (const email of data.value) {
      const sender = email.from?.emailAddress;
      const senderName = sender?.name?.toLowerCase();
      const senderAddress = sender?.address?.toLowerCase();
      if (senderName && SENDER_NAME_BLOCKLIST.has(senderName)) continue;
      if (senderAddress && SENDER_BLOCKLIST.has(senderAddress)) continue;

      const toRecipients = collectRecipientAddresses(email.toRecipients);
      const ccRecipients = collectRecipientAddresses(email.ccRecipients);
      const relevantRecipients = new Set([...toRecipients, ...ccRecipients]);
      const targetUserEmail = getTargetUserEmail();

      if (!relevantRecipients.has(targetUserEmail)) continue;

      const content = formatOutlookContent(email);

      messages.push({
        id: email.id,
        source: 'outlook',
        receivedAt: new Date(email.receivedDateTime),
        senderName: sender?.name ?? 'Unknown',
        senderEmail: sender?.address,
        channelOrFolder: 'Inbox',
        content,
        permalink: email.webLink,
      });

      if (!newLatest || email.receivedDateTime > newLatest) {
        newLatest = email.receivedDateTime;
      }
    }

    nextUrl = data['@odata.nextLink'];
  }

  if (newLatest) setOutlookCursor(newLatest);

  logger.info({ action: 'outlook_fetched', count: messages.length }, 'Outlook messages fetched');
  return messages;
}
