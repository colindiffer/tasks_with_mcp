export type MessageSource = 'slack' | 'outlook' | 'teams';

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
  conversationId?: string;
  isFromSelf?: boolean;
  automation?: {
    type: 'slack_monitor_thread';
    actionTitle: string;
    requestedBy: string;
    originalSnippet: string;
    dueDateTime: string;
    urgent: boolean;
    ruleNote: string;
  };
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ClassificationResult {
  isTask: boolean;
  isPersonal: boolean;
  confidence: ConfidenceLevel;
  actionTitle: string;       // Short imperative title, max 80 chars
  requestedBy: string;
  originalSnippet: string;   // Exact quote from message, max 300 chars
  dueDate?: string;          // ISO date/date-time — only if explicitly stated or rule-configured
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
  teams: {
    chats: Record<string, string>; // chatId -> last message datetime
  };
}
