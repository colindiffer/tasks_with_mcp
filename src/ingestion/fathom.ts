import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import type { RawMessage } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = path.resolve(__dirname, '../../state/fathom-queue.json');

interface FathomQueueItem {
  id: string;
  receivedAt: string;
  payload: {
    meeting_title?: string;
    summary?: string;
    transcript?: string;
    attendees?: { name: string; email?: string }[];
    host?: { name: string; email?: string };
    meeting_url?: string;
  };
}

export function drainQueue(): RawMessage[] {
  if (!fs.existsSync(QUEUE_FILE)) return [];

  let items: FathomQueueItem[] = [];
  try {
    items = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8')) as FathomQueueItem[];
  } catch {
    return [];
  }

  if (items.length === 0) return [];

  // Clear the queue file now — these items are being processed
  fs.writeFileSync(QUEUE_FILE, '[]', 'utf-8');

  const messages: RawMessage[] = items.map(item => {
    const p = item.payload;
    const host = p.host?.name ?? 'Unknown';
    const attendees = (p.attendees ?? []).map(a => a.name).join(', ');
    const content = [
      p.meeting_title ? `Meeting: ${p.meeting_title}` : '',
      `Attendees: ${attendees || 'Unknown'}`,
      '',
      p.summary ? `Summary:\n${p.summary}` : '',
      p.transcript ? `Transcript:\n${p.transcript}` : '',
    ].filter(Boolean).join('\n');

    return {
      id: item.id,
      source: 'fathom' as const,
      receivedAt: new Date(item.receivedAt),
      senderName: host,
      channelOrFolder: 'Meeting',
      content,
      permalink: p.meeting_url,
    };
  });

  logger.info({ action: 'fathom_drained', count: messages.length }, 'Fathom queue drained');
  return messages;
}
