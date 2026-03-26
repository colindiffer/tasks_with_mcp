import fs from 'fs';
import path from 'path';
import type { CursorState } from '../types/index.js';
import { getCursorStateFile } from './paths.js';

const STATE_FILE = getCursorStateFile();

const DEFAULT_STATE: CursorState = {
  slack: { channels: {} },
  outlook: { lastReceivedDateTime: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString() },
  teams: { chats: {} },
};

function load(): CursorState {
  if (!fs.existsSync(STATE_FILE)) return structuredClone(DEFAULT_STATE);
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as CursorState;
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function save(state: CursorState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function getSlackCursor(channelId: string): string | undefined {
  return load().slack.channels[channelId];
}

export function getSlackChannelIds(): string[] {
  return Object.keys(load().slack.channels);
}

export function setSlackCursor(channelId: string, ts: string): void {
  const state = load();
  state.slack.channels[channelId] = ts;
  save(state);
}

export function getOutlookCursor(): string {
  return load().outlook.lastReceivedDateTime;
}

export function setOutlookCursor(dateTime: string): void {
  const state = load();
  state.outlook.lastReceivedDateTime = dateTime;
  save(state);
}

export function getTeamsCursor(chatId: string): string | undefined {
  return load().teams.chats[chatId];
}

export function getTeamsChatIds(): string[] {
  return Object.keys(load().teams.chats);
}

export function setTeamsCursor(chatId: string, dateTime: string): void {
  const state = load();
  state.teams.chats[chatId] = dateTime;
  save(state);
}
