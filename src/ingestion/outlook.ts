import fetch from 'node-fetch';
import { config } from '../config/index.js';
import { getOutlookCursor, setOutlookCursor } from '../state/store.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import type { RawMessage } from '../types/index.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_URL = `https://login.microsoftonline.com/${config.outlook.tenantId}/oauth2/v2.0/token`;

let cachedToken: { value: string; expiry: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiry) return cachedToken.value;

  const res = await withRetry(() =>
    fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.outlook.clientId,
        client_secret: config.outlook.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }).toString(),
    })
  );

  if (!res.ok) throw new Error(`Graph token request failed: ${res.status} ${await res.text()}`);

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiry: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

interface GraphMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  receivedDateTime: string;
  from: { emailAddress: { name: string; address: string } };
  webLink: string;
}

interface GraphResponse {
  value: GraphMessage[];
}

export async function fetchNewMessages(): Promise<RawMessage[]> {
  const since = getOutlookCursor();
  const messages: RawMessage[] = [];
  let newLatest: string | undefined;

  const token = await getAccessToken();

  const filter = `receivedDateTime gt ${since}`;
  const url = `${GRAPH_BASE}/users/${config.outlook.userEmail}/mailFolders/inbox/messages` +
    `?$filter=${encodeURIComponent(filter)}&$orderby=receivedDateTime asc&$top=50` +
    `&$select=id,subject,bodyPreview,receivedDateTime,from,webLink`;

  const res = await withRetry(() =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  );

  if (!res.ok) throw new Error(`Graph messages request failed: ${res.status} ${await res.text()}`);

  const data = await res.json() as GraphResponse;

  for (const email of data.value) {
    const content = `Subject: ${email.subject}\n\n${email.bodyPreview}`;

    messages.push({
      id: email.id,
      source: 'outlook',
      receivedAt: new Date(email.receivedDateTime),
      senderName: email.from.emailAddress.name,
      senderEmail: email.from.emailAddress.address,
      channelOrFolder: 'Inbox',
      content,
      permalink: email.webLink,
    });

    if (!newLatest || email.receivedDateTime > newLatest) {
      newLatest = email.receivedDateTime;
    }
  }

  if (newLatest) setOutlookCursor(newLatest);

  logger.info({ action: 'outlook_fetched', count: messages.length }, 'Outlook messages fetched');
  return messages;
}
