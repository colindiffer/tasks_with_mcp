import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_DIR = path.resolve(__dirname, '../../state');

export function getStateDir(): string {
  return process.env.STATE_DIR?.trim()
    || process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim()
    || DEFAULT_STATE_DIR;
}

export function getCursorStateFile(): string {
  return process.env.STATE_FILE?.trim()
    || path.join(getStateDir(), 'cursors.json');
}

export function getOutlookRefreshTokenFile(): string {
  return process.env.OUTLOOK_TOKEN_FILE?.trim()
    || path.join(getStateDir(), 'outlook-refresh-token.txt');
}
