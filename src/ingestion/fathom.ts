import { withMcp } from '../mcp/clients.js';
import { getFathomCursor, setFathomCursor } from '../state/store.js';
import { logger } from '../utils/logger.js';
import type { RawMessage } from '../types/index.js';

interface FathomMeeting {
  title: string;
  date: string;
  url?: string;
  attendees?: { name?: string; email?: string }[];
  recorded_by?: { name?: string; email?: string };
  summary?: string;
  action_items?: string;
}

interface FathomListResponse {
  meetings: FathomMeeting[];
  total_found: number;
  has_more: boolean;
}

export async function fetchNewMeetings(): Promise<RawMessage[]> {
  return withMcp('fathom', async (call) => {
    const cursor = getFathomCursor();

    // Default to 7 days ago on first run so we don't pull all history
    const createdAfter = cursor || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const result = await call('list_meetings', {
      created_after: createdAfter,
      include_transcript: false,
      limit: 20,
    }) as FathomListResponse;

    const meetings = result.meetings ?? [];
    if (meetings.length === 0) {
      logger.info({ action: 'fathom_fetched', count: 0 }, 'No new Fathom meetings');
      return [];
    }

    let newLatestDate: string | undefined;
    const messages: RawMessage[] = meetings.map(meeting => {
      const host = meeting.recorded_by?.name ?? 'Unknown';
      const attendees = (meeting.attendees ?? [])
        .map(a => a.name ?? a.email ?? 'Unknown')
        .join(', ');

      const content = [
        meeting.title ? `Meeting: ${meeting.title}` : '',
        `Attendees: ${attendees || 'Unknown'}`,
        '',
        meeting.summary ? `Summary:\n${meeting.summary}` : '',
        meeting.action_items ? `Action items:\n${meeting.action_items}` : '',
      ].filter(Boolean).join('\n');

      if (!newLatestDate || meeting.date > newLatestDate) newLatestDate = meeting.date;

      return {
        id: meeting.date + (meeting.title ?? ''),
        source: 'fathom' as const,
        receivedAt: new Date(meeting.date),
        senderName: host,
        channelOrFolder: 'Meeting',
        content,
        permalink: meeting.url,
      };
    });

    if (newLatestDate) setFathomCursor(newLatestDate);
    logger.info({ action: 'fathom_fetched', count: messages.length }, 'Fathom meetings fetched');
    return messages;
  });
}
