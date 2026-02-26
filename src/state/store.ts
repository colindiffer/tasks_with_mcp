import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CursorState } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(__dirname, '../../state/cursors.json');

const DEFAULT_STATE: CursorState = {
  slack: { channels: {} },
  outlook: { lastReceivedDateTime: new Date(0).toISOString() },
  fathom: { lastProcessedMeetingDate: '' },
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

export function getFathomCursor(): string {
  return load().fathom.lastProcessedMeetingDate;
}

export function setFathomCursor(meetingDate: string): void {
  const state = load();
  state.fathom.lastProcessedMeetingDate = meetingDate;
  save(state);
}
