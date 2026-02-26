export type MessageSource = 'slack' | 'outlook' | 'fathom';

export interface RawMessage {
  id: string;
  source: MessageSource;
  receivedAt: Date;
  senderName: string;
  senderEmail?: string;
  channelOrFolder?: string;
  content: string;
  permalink?: string;
  threadId?: string;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ClassificationResult {
  isTask: boolean;
  confidence: ConfidenceLevel;
  actionTitle: string;       // Short imperative title, max 80 chars
  requestedBy: string;
  originalSnippet: string;   // Exact quote from message, max 300 chars
  dueDate?: string;          // ISO date YYYY-MM-DD — only if explicitly stated
  reasoning: string;         // One sentence explanation for logs/audit
}

export interface TaskCandidate {
  raw: RawMessage;
  classification: ClassificationResult;
}

export interface TrelloCardPayload {
  name: string;
  desc: string;
  due?: string;
  idList: string;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  due: string | null;
  url: string;
}

export type DedupDecision = 'create' | 'skip' | 'append';

export interface DedupResult {
  decision: DedupDecision;
  matchedCardId?: string;
  matchedCardName?: string;
}

export interface CursorState {
  slack: {
    channels: Record<string, string>; // channelId -> last message ts
  };
  outlook: {
    lastReceivedDateTime: string; // ISO datetime
  };
  fathom: {
    lastProcessedMeetingDate: string; // ISO datetime of most recent processed meeting
  };
}
