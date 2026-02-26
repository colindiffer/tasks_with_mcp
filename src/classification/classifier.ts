import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config/index.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import type { RawMessage, ClassificationResult } from '../types/index.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const ClassificationSchema = z.object({
  isTask: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  actionTitle: z.string().max(80),
  requestedBy: z.string(),
  originalSnippet: z.string().max(300),
  dueDate: z.string().nullable().optional(),
  reasoning: z.string(),
});

export async function classify(msg: RawMessage): Promise<ClassificationResult> {
  const rawResponse = await withRetry(async () => {
    const response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(msg) }],
    });

    const text = response.content[0];
    if (text?.type !== 'text') throw new Error('Unexpected response type from Claude');
    return text.text;
  });

  try {
    const parsed = JSON.parse(rawResponse);
    const validated = ClassificationSchema.parse(parsed);
    return {
      isTask: validated.isTask,
      confidence: validated.confidence,
      actionTitle: validated.actionTitle,
      requestedBy: validated.requestedBy,
      originalSnippet: validated.originalSnippet,
      dueDate: validated.dueDate ?? undefined,
      reasoning: validated.reasoning,
    };
  } catch (err) {
    logger.error({ source: msg.source, messageId: msg.id, rawResponse, err }, 'Failed to parse Claude classification response — skipping message');
    // Return a safe "not a task" result so the pipeline can continue
    return {
      isTask: false,
      confidence: 'low',
      actionTitle: '',
      requestedBy: '',
      originalSnippet: '',
      reasoning: 'Classification parse error — skipped',
    };
  }
}
