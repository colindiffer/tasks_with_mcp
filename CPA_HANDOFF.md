# CPA Handoff

## What CPA does

CPA (Colin's Personal Assistant) watches work-related requests across Slack, Outlook, and Teams chats, decides whether each item is a real task, deduplicates it, and creates Trello cards in the `CPA` intake list.

Trello is the single system of record. Automation only writes to the `CPA` list. Colin then manually triages cards into the rest of the board flow.

## End-to-end process

1. `src/index.ts` starts the app, runs one pipeline pass immediately, and registers cron schedules.
2. `src/pipeline/runner.ts` fetches new items from each enabled source.
3. Each source normalizes its data into `RawMessage`.
4. `src/classification/classifier.ts` sends each non-rule-based message to OpenAI for task classification.
5. Personal/social items are skipped.
6. Low-confidence or non-task items are skipped.
7. `src/feedback/rules.ts` checks whether the candidate resembles a known bad example from the Trello `AI Feedback` list.
8. `src/dedup/deduplicator.ts` compares the candidate against existing open Trello cards.
9. If it survives the checks, `src/trello/client.ts` creates a card in the Trello `CPA` list.
10. Per-source cursors are saved in the configured state path so the next run continues from the last successful position.

## System connections

### 1. Slack

- Code: `src/ingestion/slack.ts`
- Auth: `SLACK_ACCESS_TOKEN` user token (`xoxp-...`)
- APIs used:
  - `auth.test`
  - `search.messages`
  - `conversations.list`
  - `conversations.info`
  - `conversations.history`
  - `users.info`
  - `chat.getPermalink`
- What it ingests:
  - `@mentions`
  - direct messages and group DMs
  - configured monitor-channel root posts
- Special handling:
  - Colin's own messages are skipped
  - inbound Slack bursts from the same sender in the same thread/DM can be collapsed into one classification candidate
  - configured monitor channels bypass the classifier and create urgent Trello tasks with a fixed 24-hour due date

### 2. Microsoft Graph: Outlook

- Code: `src/ingestion/outlook.ts`
- Auth: delegated OAuth refresh token supplied initially via `OUTLOOK_REFRESH_TOKEN`, then persisted to the configured token file after rotation
- Setup helper: `scripts/auth-outlook.ts`
- APIs used:
  - `POST https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`
  - `GET https://graph.microsoft.com/v1.0/me/messages`
- Scope used by the app: `Mail.Read`
- Filtering rules:
  - email is ignored unless `colin@propellernet.co.uk` is in `To` or `Cc`
  - sender blocklists are applied before classification
  - Graph pagination via `@odata.nextLink` is followed until complete

### 3. Microsoft Graph: Teams chats

- Code: `src/ingestion/teams.ts`
- Auth: same delegated OAuth refresh token as Outlook
- APIs used:
  - `GET https://graph.microsoft.com/v1.0/me`
  - `GET https://graph.microsoft.com/v1.0/me/chats`
  - `GET https://graph.microsoft.com/v1.0/chats/{chatId}`
  - `GET https://graph.microsoft.com/v1.0/chats/{chatId}/messages`
- Scopes used by the app:
  - `Chat.Read`
  - `ChatMessage.Read`
- Current scope of ingestion:
  - Teams chats only
  - no Teams activity feed
  - no Teams channel posts
- Special handling:
  - Colin's own messages are skipped
  - normal runs prefer already-known chat IDs
  - full sweeps discover all chats

### 4. Meeting follow-up capture

- Dedicated Fathom ingestion has been removed.
- Expected behavior:
  - Fathom sends recap/action-item emails
  - Outlook ingestion pulls those emails through Microsoft Graph
  - the classifier decides whether each email contains a real task for Colin

### 5. OpenAI

- Code: `src/classification/classifier.ts`
- Auth: `OPENAI_API_KEY`
- Model env var: `OPENAI_MODEL` default `gpt-4.1-mini`
- API used:
  - `POST https://api.openai.com/v1/responses`
- Purpose:
  - determine if the message is a task
  - label personal vs work
  - assign confidence
  - extract short action title
  - extract requester
  - extract exact message snippet
  - extract due date only when explicit

### 6. Trello

- Write client: `src/trello/client.ts`
- Feedback rules: `src/feedback/rules.ts`
- Field inference: `src/trello/field-matcher.ts`
- Auth:
  - `TRELLO_API_KEY`
  - `TRELLO_TOKEN`
- APIs used:
  - `GET /1/lists/{id}/cards`
  - `POST /1/cards`
  - `POST /1/cards/{id}/actions/comments`
  - `GET /1/boards/{id}?pluginData=true`
  - `GET /1/lists/{id}/cards?pluginData=true`
- Purpose:
  - create new intake cards
  - load existing intake cards for deduplication
  - read board/card plugin data for Amazing Fields-backed feedback rules
- Important board rules:
  - automation writes only to `TRELLO_INTAKE_LIST_ID`
  - Amazing Fields values are inferred and written into the card description, not back into the Amazing Fields UI

## Scheduling methods actually implemented

### 1. Immediate startup run

When the process starts, `src/index.ts` calls `runOnce()` immediately before any cron tick. This gives catch-up behavior after a restart.

### 2. Main pipeline cron

- Env var: `CRON_SCHEDULE`
- Default: `*/15 * * * *`
- Purpose: runs the normal multi-source pipeline across Slack, Outlook, and Teams

### 3. Slack monitor-channel cron

- Env var: `SLACK_MONITOR_CRON_SCHEDULE`
- Default: `*/5 * * * *`
- Purpose: runs a lightweight Slack-only poll for configured monitor channels
- Behavior: only checks root posts in `SLACK_MONITOR_THREAD_CHANNELS`

### 4. Full sweep cron

- Env var: `SLACK_FULL_SWEEP_CRON_SCHEDULE`
- Default: `0 0 * * *`
- Purpose: runs a heavier catch-up sweep
- Current behavior:
  - full Slack DM discovery/sweep
  - full Teams chat discovery sweep

### 5. Startup full sweep toggle

- Env var: `STARTUP_FULL_SWEEP`
- Default: `false`
- Purpose: if enabled, the immediate startup run becomes a full Slack DM + Teams sweep instead of the lighter normal scan

### 6. Backfill window overrides

- Env vars:
  - `BACKFILL_SINCE`
  - `BACKFILL_UNTIL`
- Purpose:
  - bounded replays
  - controlled historical catch-up
- Effect:
  - sources use the supplied time window instead of relying only on saved cursors
  - Slack and Teams can switch into broader discovery behavior during a replay

### 7. In-process overlap guard

`src/index.ts` keeps a `running` flag. If one tick is still active when the next cron fires, the new tick is skipped rather than overlapping.

### 8. Background process launcher

- Script: `scripts/start-cpa-background.ps1`
- NPM command: `npm run start:bg`
- What it does:
  - starts `node dist/index.js`
  - writes stdout to `logs/cpa.out.log`
  - writes stderr to `logs/cpa.err.log`
  - writes the PID to `state/cpa.pid`
  - refuses to start a second copy if the PID file still points to a live process

## Local state and operational files

- `.env`
  - secrets and schedule configuration
- `state/cursors.json`
  - default local cursor file when no override or Railway volume is used
- `state/outlook-refresh-token.txt`
  - default local Graph refresh-token persistence file
- `state/cpa.pid`
  - PID of the background process started by `start-cpa-background.ps1`
- `logs/cpa.out.log`
  - standard output from background mode
- `logs/cpa.err.log`
  - standard error from background mode

Runtime path behavior:

- `STATE_DIR` overrides the base state directory
- `STATE_FILE` overrides the cursor file path directly
- `OUTLOOK_TOKEN_FILE` overrides the Graph refresh-token file path directly
- on Railway, set `STATE_DIR` to the attached volume mount path so cursor state and refresh-token rotations persist
- `FIRST_RUN_LOOKBACK_HOURS` controls how much recent history is scanned when there is no persisted cursor state yet

## Required and optional credentials

### Required for startup

- `SLACK_ACCESS_TOKEN`
- `OPENAI_API_KEY`
- `TRELLO_API_KEY`
- `TRELLO_TOKEN`
- `TRELLO_BOARD_ID`
- `TRELLO_INTAKE_LIST_ID`

### Optional but required for Outlook/Teams ingestion

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `OUTLOOK_REFRESH_TOKEN`

## How to hand this over to another operator

1. Give them the repo plus this document.
2. Give them the `.env` values through a secure channel. Do not commit or email raw secrets in plain text.
3. Confirm Microsoft Graph admin consent exists for `Mail.Read`, `Chat.Read`, and `ChatMessage.Read`.
4. If the Graph token is missing or stale, run `npx tsx scripts/auth-outlook.ts` locally and complete the browser login.
5. Build the project with `npm run build`.
6. For foreground verification, run `npm run dev`.
7. For persistent local background execution, run `npm run start:bg`.
8. Check `logs/cpa.out.log`, `logs/cpa.err.log`, and `state/cpa.pid` after startup.
9. Check Trello `CPA` list output before assuming the automation is healthy.

## Railway deployment notes

- Preferred compute type: persistent service
- Build command: `npm run build`
- Start command: `npm start`
- Attach one Railway volume to the service so cursor state and Graph refresh-token rotations survive restarts
- Set `STATE_DIR` to that volume's mount path, for example `/data`
- Keep `FIRST_RUN_LOOKBACK_HOURS` low on fresh environments to avoid large historical backfills; current default is `2`
- Do not use `npm run start:bg` on Railway; that script is only for local Windows background execution

## Current operational limits

- The app only runs while the local machine/process is running.
- If the laptop is off, cron jobs do not fire.
- The next startup run catches up from cursors, but missed wall-clock cron executions are not replayed as separate events.
- Teams support is chat-only.
- Slack full DM sweeps are intentionally limited because they can be slow and rate-limited.
- Meeting recap capture now depends on Fathom emails arriving in Outlook.

## Key files

- `src/index.ts`
- `src/pipeline/runner.ts`
- `src/config/index.ts`
- `src/ingestion/slack.ts`
- `src/ingestion/outlook.ts`
- `src/ingestion/teams.ts`
- `src/ingestion/microsoft-graph.ts`
- `src/classification/classifier.ts`
- `src/dedup/deduplicator.ts`
- `src/feedback/rules.ts`
- `src/trello/client.ts`
- `src/state/paths.ts`
- `src/state/store.ts`
- `scripts/auth-outlook.ts`
- `scripts/start-cpa-background.ps1`
- `railway.json`
