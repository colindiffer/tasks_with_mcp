# Copilot Instructions

## What this project does

CPA (Colin's Personal Assistant) ingests Slack DMs/mentions, Outlook emails, and Teams chats on a cron schedule, classifies them with OpenAI, deduplicates them, and pushes valid tasks into the **CPA** Trello list. Colin manually triages the intake list before any work begins. Precision over recall — noise is never acceptable.

## Commands

```bash
npm run dev       # Run with tsx (development, hot-ish)
npm run build     # tsc compile to dist/
npm start         # Run compiled output from dist/

npx tsc --noEmit  # Type-check only (no test suite)

# One-time Microsoft Graph OAuth setup (Outlook + Teams chats; requires IT admin consent first):
npx tsx scripts/auth-outlook.ts
```

There is no test suite. Type-check with `npx tsc --noEmit`.

## Architecture

The pipeline runs on a cron schedule (default: every 15 min). `src/index.ts` calls `src/pipeline/runner.ts`, which:

1. **Ingests** from three sources — each returns `RawMessage[]`:
   - `src/ingestion/slack.ts` — @mentions (via paginated `search.messages`) + DMs/group DMs (cursor-tracked per channel) + configured monitor-channel root posts (via `search.messages`). Normal runs scan known DM threads only; bounded replays/full sweeps can page `conversations.list` and `conversations.history`.
   - `src/ingestion/outlook.ts` — Microsoft Graph API with delegated OAuth refresh token, cursor-tracked by `receivedDateTime`. Fathom recap emails are handled here and Colin-assigned action items are surfaced before classification.
   - `src/ingestion/teams.ts` — Microsoft Graph Teams chats only (not activity), cursor-tracked per chat ID. Normal runs scan known chats only; full sweeps discover all chats.

2. **Classifies** each `RawMessage` via OpenAI Responses API (`OPENAI_MODEL`, default `gpt-4.1-mini`) — returns `ClassificationResult` with `isTask`, `isPersonal`, `confidence`, `actionTitle`, `requestedBy`, `originalSnippet`, `dueDate`, `reasoning`

3. **Deduplicates** against open cards in the CPA Trello list using word-overlap scoring (threshold: 0.6)

4. **Creates a Trello card** in the CPA list if `isTask: true`, `confidence !== 'low'`, and dedup says `create`
   - Card titles are prefixed with the source, e.g. `Slack: ...`, `Email: ...`, `Meeting: ...`

**Cursor state** is persisted to the configured state path (default local file `state/cursors.json`; on Railway set `STATE_DIR` to a mounted volume path). Each source advances its own cursor after a successful fetch.
There are two schedules by default:
- `CRON_SCHEDULE=*/15 * * * *` for the normal pipeline run
- `SLACK_MONITOR_CRON_SCHEDULE=*/5 * * * *` for a lightweight Slack monitor-channel root-post poll
- `SLACK_FULL_SWEEP_CRON_SCHEDULE=0 0 * * *` for a daily midnight full Slack DM + Teams chat discovery sweep

## Key conventions

### TypeScript / ESM
- `"module": "NodeNext"` — all local imports **must** use `.js` extension even though files are `.ts`:
  ```ts
  import { logger } from '../utils/logger.js'; // correct
  import { logger } from '../utils/logger';    // breaks at runtime
  ```
- Strict mode enabled. No implicit `any`.

### `RawMessage` is the universal pipeline type
Every ingestion source normalises into `RawMessage` (defined in `src/types/index.ts`). This is the only type the classifier and pipeline operate on. When adding a new source, produce `RawMessage[]`.

### Classification rules (critical — don't loosen)
- **Low confidence always skips** — no card created
- **Personal/social messages always skip** — no card created
- **Medium confidence creates a card** but adds a `⚠️ Medium confidence — review before acting` badge in the description
- The model prompt is strict: FYIs, automated notifications, and passive observations must not become tasks
- Weekend plans, marathon chat, races, family logistics, hobby conversation, and other personal/social reply prompts are out of scope for the CPA work board
- Unsolicited sales outreach should not become tasks. Free audits, demo offers, white-label pitches, and similar prospecting emails are noise unless Colin explicitly asked for them
- `dueDate` is only set when **explicitly stated** in the message — never inferred from tone
- Structured Outputs are requested with a JSON schema and still validated with Zod in `src/classification/classifier.ts`

### Deduplication
- Compares normalised word overlap between the candidate title and existing open cards in CPA
- Also compares the candidate `originalSnippet` against existing card descriptions to catch duplicates where the title wording differs but the underlying request is the same
- Threshold: `0.6` — a candidate with ≥60% word overlap with any existing card is skipped
- Cache is invalidated at the start of each pipeline run, then cached for 5 min within the run

### State / cursors
- `state/cursors.json` is the default local cursor store (gitignored, never commit)
- `OUTLOOK_TOKEN_FILE` defaults to `state/outlook-refresh-token.txt` for Graph refresh-token persistence after rotation
- Slack mentions use key `__mentions__`; DMs use the channel ID
- Default lookback: Outlook = 14 days, Slack = hard floor `2026-02-16` (Unix `1739664000`)
- For bounded replays, prefer `BACKFILL_SINCE` and `BACKFILL_UNTIL` so newly discovered Slack DM channels do not pull unnecessary older history

### Logging
Pino structured logging. Always pass a context object as the first argument:
```ts
logger.info({ action: 'card_created', cardId: card.id }, 'Trello card created');
logger.error({ action: 'source_failed', source: 'slack', err }, 'Slack ingestion failed');
```
Pretty-printed in dev, JSON in production. `LOG_LEVEL` env var controls verbosity.

### Retry
`withRetry()` in `src/utils/retry.ts` wraps external HTTP calls (OpenAI, Microsoft Graph). Defaults: 3 attempts, exponential backoff starting at 1s.

### Outlook auth
Uses delegated OAuth (refresh token flow, not client credentials). An initial refresh token is provided via `OUTLOOK_REFRESH_TOKEN`. If Microsoft rotates it, the app persists the new token to the configured token file instead of rewriting `.env`. Outlook and Teams are silently skipped if no refresh token is available.
- Graph scopes requested by `scripts/auth-outlook.ts`: `Mail.Read Chat.Read ChatMessage.Read offline_access`
- If the refresh token was created before Teams support was added, rerun `npx tsx scripts/auth-outlook.ts` to grant the extra Teams scopes

### Outlook filtering
- Ignore emails unless `colin@propellernet.co.uk` is present in the `To` or `Cc` recipients
- Do not create tasks from mail that is only relevant to broad/shared mailboxes; this rule exists to keep team-wide notifications out of Colin's intake
- Outlook ingestion follows Microsoft Graph pagination; do not assume the first 50 messages are the complete result set
- Skip blocked Outlook sender display names such as `Bing Ads Service` before classification

### Trello
Direct REST API (no SDK). All automation writes to `TRELLO_INTAKE_LIST_ID` only. The board flow is **CPA → Approved → This Week → Waiting On → Done**.
- The board UI currently uses the Amazing Fields Power-Up. The automation can infer field values such as `Client` and `Request Type`, but with the current Trello user-token API those matches are written into the card description rather than into Amazing Fields plugin data.
- `AI Feedback` cards can be used as negative examples. If a feedback card has Amazing Fields `Issue` set to `Spam`, `Sales outreach`, `Duplicate`, or `Should have been ignored`, similar future tasks are skipped.

### Slack token
Uses a **user token** (`xoxp-`), not a bot token — required for `search.messages` scope. `SLACK_DM_EXCLUDELIST` is a comma-separated list of DM names or channel IDs to skip.
- Skip Slack messages authored by Colin before classification. When several inbound Slack messages from the same sender land in the same DM/thread within a short window, collapse them into one classification candidate so one conversation does not create several Trello cards.
- `SLACK_MONITOR_THREAD_CHANNELS` is a comma-separated list of Slack channels where new root posts should always create urgent Trello tasks with a 24-hour due time. Default: `gtm_monitor_checks`.
- `SLACK_MONITOR_CRON_SCHEDULE` controls how often those monitor-channel root posts are checked. Default: every 5 minutes.
- On first run, monitor-channel polling looks back 24 hours by default unless `BACKFILL_SINCE` is set, which captures recent posts without pulling full historical backlog.
- `SLACK_FULL_DM_SWEEP=true` forces discovery of all DM/group-DM conversations. Leave it off for normal fast runs.

### Teams
- Only Teams chats are ingested. This does **not** read the Teams activity feed and does **not** ingest channel posts.
- Normal runs scan already-known chat IDs; the midnight full sweep discovers newly created chats.
- Messages sent by Colin himself are skipped before classification.

## Environment variables

See `.env.example`. Required variables that crash on startup if missing:
`SLACK_ACCESS_TOKEN`, `OPENAI_API_KEY`, `TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD_ID`, `TRELLO_INTAKE_LIST_ID`

Outlook/Teams variables are optional — ingestion is skipped gracefully if not configured.

## Current status (see PROGRESS.md for details)

- Slack: code complete, user token set
- Outlook: code complete, delegated Microsoft Graph auth
- Teams: code complete for chats only, using delegated Microsoft Graph auth
