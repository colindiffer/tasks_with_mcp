import { z } from 'zod';
import { config } from '../config/index.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import type { RawMessage, ClassificationResult } from '../types/index.js';

const ClassificationSchema = z.object({
  isTask: z.boolean(),
  isPersonal: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  actionTitle: z.string().max(80),
  requestedBy: z.string(),
  originalSnippet: z.string().max(300),
  dueDate: z.string().nullable().optional(),
  reasoning: z.string(),
});

const responseFormat = {
  type: 'json_schema',
  name: 'task_classification',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      isTask: { type: 'boolean' },
      isPersonal: { type: 'boolean' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      actionTitle: { type: 'string', maxLength: 80 },
      requestedBy: { type: 'string' },
      originalSnippet: { type: 'string', maxLength: 300 },
      dueDate: { type: ['string', 'null'] },
      reasoning: { type: 'string' },
    },
    required: ['isTask', 'isPersonal', 'confidence', 'actionTitle', 'requestedBy', 'originalSnippet', 'dueDate', 'reasoning'],
  },
} as const;

interface OpenAiResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

function extractResponseText(data: OpenAiResponse): string | undefined {
  if (data.output_text) return data.output_text;

  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) return content.text;
      if (content.text) return content.text;
    }
  }

  return undefined;
}

const INTERNAL_DOMAINS = ['propellernet.co.uk'];

const SALES_OUTREACH_PATTERNS = [
  'free cro audit',
  'free audit',
  'white-label',
  'white label',
  'normally £',
  'normally $',
  'pitch it to',
  'pitch this to',
  'your clients',
  'let me send you',
  'want to try it',
  'book a demo',
  'schedule a demo',
  'quick call to show',
  'can i send you',
  'can i show you',
  'can i share a deck',
  'would you be open to',
  'no risk for you',
];

function isInternalSender(email: string | undefined): boolean {
  if (!email) return false;
  const domain = email.toLowerCase().split('@')[1];
  return INTERNAL_DOMAINS.includes(domain ?? '');
}

function isLikelySalesOutreach(msg: RawMessage): boolean {
  if (msg.source !== 'outlook') return false;
  if (isInternalSender(msg.senderEmail)) return false;

  const content = msg.content.toLowerCase();
  const matches = SALES_OUTREACH_PATTERNS.filter(pattern => content.includes(pattern));
  return matches.length >= 2;
}

export async function classify(msg: RawMessage): Promise<ClassificationResult> {
  if (isLikelySalesOutreach(msg)) {
    return {
      isTask: false,
      isPersonal: false,
      confidence: 'low',
      actionTitle: '',
      requestedBy: '',
      originalSnippet: '',
      reasoning: 'Unsolicited sales outreach or vendor pitch — skipped',
    };
  }

  const rawResponse = await withRetry(async () => {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.openai.model,
        instructions: SYSTEM_PROMPT,
        input: buildUserPrompt(msg),
        max_output_tokens: 512,
        text: { format: responseFormat },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI responses request failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as OpenAiResponse;
    const text = extractResponseText(data);
    if (!text) throw new Error('OpenAI response did not include usable text output');
    return text;
  });

  try {
    const parsed = JSON.parse(rawResponse);
    const validated = ClassificationSchema.parse(parsed);
    return {
      isTask: validated.isTask,
      isPersonal: validated.isPersonal,
      confidence: validated.confidence,
      actionTitle: validated.actionTitle,
      requestedBy: validated.requestedBy,
      originalSnippet: validated.originalSnippet,
      dueDate: validated.dueDate ?? undefined,
      reasoning: validated.reasoning,
    };
  } catch (err) {
    logger.error({ source: msg.source, messageId: msg.id, rawResponse, err }, 'Failed to parse OpenAI classification response — skipping message');
    // Return a safe "not a task" result so the pipeline can continue
    return {
      isTask: false,
      isPersonal: false,
      confidence: 'low',
      actionTitle: '',
      requestedBy: '',
      originalSnippet: '',
      reasoning: 'Classification parse error — skipped',
    };
  }
}
