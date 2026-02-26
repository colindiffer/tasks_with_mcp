import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = path.resolve(__dirname, '../../state/fathom-queue.json');

interface FathomQueueItem {
  id: string;
  receivedAt: string;
  payload: unknown;
}

function readQueue(): FathomQueueItem[] {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8')) as FathomQueueItem[];
  } catch {
    return [];
  }
}

function appendToQueue(item: FathomQueueItem): void {
  const queue = readQueue();
  queue.push(item);
  fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf-8');
}

export function startWebhookServer(): void {
  const app = express();
  app.use(express.json());

  app.post('/fathom/webhook', (req, res) => {
    const secret = req.headers['x-fathom-secret'] ?? req.headers['x-webhook-secret'];
    if (secret !== config.fathom.webhookSecret) {
      logger.warn({ action: 'webhook_auth_failed' }, 'Fathom webhook rejected — invalid secret');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const id = `fathom_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    appendToQueue({ id, receivedAt: new Date().toISOString(), payload: req.body });
    logger.info({ action: 'webhook_received', id }, 'Fathom webhook queued');
    res.status(200).json({ ok: true });
  });

  app.listen(config.fathom.webhookPort, () => {
    logger.info({ action: 'webhook_started', port: config.fathom.webhookPort }, 'Fathom webhook server listening');
  });
}
