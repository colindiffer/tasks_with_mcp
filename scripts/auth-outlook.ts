/**
 * One-time Microsoft Graph OAuth setup for Outlook + Teams chats.
 * Run: npx tsx scripts/auth-outlook.ts
 * Opens your browser, you log in, refresh token is saved to .env automatically.
 */

import 'dotenv/config';
import http from 'http';
import { exec } from 'child_process';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const TENANT_ID = process.env.AZURE_TENANT_ID!;
const CLIENT_ID = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;
const REDIRECT_URI = 'http://localhost:3000/auth/callback';
const SCOPES = 'https://graph.microsoft.com/Mail.Read Chat.Read ChatMessage.Read offline_access';

const authUrl =
  `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize` +
  `?client_id=${CLIENT_ID}` +
  `&response_type=code` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&response_mode=query`;

console.log('\nOpening browser for Microsoft Graph auth...\n');
exec(`start "" "${authUrl}"`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:3000`);
  if (url.pathname !== '/auth/callback') return;

  const code = url.searchParams.get('code');
  if (!code) {
    res.end('No code received. Try again.');
    server.close();
    return;
  }

  try {
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          redirect_uri: REDIRECT_URI,
          scope: SCOPES,
        }).toString(),
      }
    );

    const data = await tokenRes.json() as { refresh_token?: string; error_description?: string };

    if (!data.refresh_token) {
      res.end(`Auth failed: ${data.error_description}`);
      server.close();
      return;
    }

    // Write refresh token into .env
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');
    if (envContent.includes('OUTLOOK_REFRESH_TOKEN=')) {
      envContent = envContent.replace(/OUTLOOK_REFRESH_TOKEN=.*/,`OUTLOOK_REFRESH_TOKEN=${data.refresh_token}`);
    } else {
      envContent += `\nOUTLOOK_REFRESH_TOKEN=${data.refresh_token}`;
    }
    fs.writeFileSync(envPath, envContent);

    console.log('✓ Refresh token saved to .env');
    res.end('<h2>Done! You can close this tab.</h2>');
  } catch (err) {
    res.end(`Error: ${err}`);
  }

  server.close();
});

server.listen(3000, () => {
  console.log('Waiting for auth callback on http://localhost:3000 ...\n');
});
