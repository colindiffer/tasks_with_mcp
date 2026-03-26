import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { getOutlookRefreshTokenFile } from '../state/paths.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_URL = `https://login.microsoftonline.com/${config.outlook.tenantId}/oauth2/v2.0/token`;
const GRAPH_SCOPE = 'https://graph.microsoft.com/Mail.Read Chat.Read ChatMessage.Read offline_access';

let cachedToken: { value: string; expiry: number } | null = null;

export function getGraphBase(): string {
  return GRAPH_BASE;
}

function getStoredRefreshToken(): string | undefined {
  const tokenFile = getOutlookRefreshTokenFile();
  if (fs.existsSync(tokenFile)) {
    const persisted = fs.readFileSync(tokenFile, 'utf-8').trim();
    if (persisted) return persisted;
  }

  return process.env.OUTLOOK_REFRESH_TOKEN?.trim();
}

function persistRefreshToken(refreshToken: string): void {
  const tokenFile = getOutlookRefreshTokenFile();
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, refreshToken, 'utf-8');
  process.env.OUTLOOK_REFRESH_TOKEN = refreshToken;
}

export function isMicrosoftGraphConfigured(): boolean {
  return Boolean(config.outlook.tenantId && config.outlook.clientId && getStoredRefreshToken());
}

export async function getMicrosoftGraphAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiry) return cachedToken.value;

  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    throw new Error('OUTLOOK_REFRESH_TOKEN not set — provide it via env or run: npx tsx scripts/auth-outlook.ts');
  }

  const res = await withRetry(() =>
    fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.outlook.clientId,
        client_secret: config.outlook.clientSecret,
        refresh_token: refreshToken,
        scope: GRAPH_SCOPE,
      }).toString(),
    })
  );

  if (!res.ok) throw new Error(`Graph token request failed: ${res.status} ${await res.text()}`);

  const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };

  if (data.refresh_token && data.refresh_token !== refreshToken) {
    persistRefreshToken(data.refresh_token);
    logger.info({ tokenFile: getOutlookRefreshTokenFile() }, 'Microsoft Graph refresh token rotated and persisted');
  }

  cachedToken = {
    value: data.access_token,
    expiry: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}
