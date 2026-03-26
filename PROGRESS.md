# Progress Log

## Status: Slack rate limited from debug session — leave until evening/tomorrow to reset. Outlook + Teams pending IT admin consent.

---

## Integration Status

| Service | Type | Status | Notes |
|---------|------|--------|-------|
| Slack   | Direct API | ✅ connected | Full user access |
| Outlook | Microsoft Graph | ⏳ waiting on IT | Will also carry Fathom recap emails |
| Teams   | Microsoft Graph | ⏳ waiting on IT | Chat-only scope |
| Trello  | Direct REST API | ✅ connected | MCP removed |

---

## Source status

| Source | Status | Notes |
|--------|--------|-------|
| Slack DMs + mentions | ✅ code complete | Rate limited from debug session — will recover |
| Fathom recap emails via Outlook | planned | Dedicated Fathom ingestion removed |
| Outlook email | ⏳ waiting on IT | Admin consent needed for Mail.Read delegated |
| Teams chat | ⏳ waiting on IT | Admin consent needed for Chat.Read delegated |
| Gmail / Google Calendar | ⚪ optional/later | |

---

## What's been resolved

### Slack scopes ✅
User token scopes: `search:read`, `im:read`, `im:history`, `mpim:read`, `mpim:history`, `channels:read`, `users:read`

### Slack ingestion fixes ✅
- User cache — `users.info` called once per unique user, not per message
- Lookback floor — `EARLIEST_TS = 1739664000` (2026-02-16), never fetches before this
- Concurrency lock — cron skips if previous run still in progress
- DM throttle — 3000ms delay between `conversations.history` calls (~20 req/min)
- Channel limit — `conversations.list` limited to 50, excludes configured channels
- `SLACK_DM_EXCLUDELIST` — comma-separated names or channel IDs to skip
- `SLACK_MONITOR_THREAD_CHANNELS` — root posts in configured channels (default `gtm_monitor_checks`) auto-create urgent Trello tasks with a 24-hour due time
- `SLACK_MONITOR_CRON_SCHEDULE` — lightweight poll for monitor-channel root posts, independent from the normal 15-minute pipeline schedule
- Startup catch-up — keep startup on known-source cursors by default; a full Slack DM sweep over hundreds of conversations is too slow for normal startup

### Fathom path removed
Meeting follow-ups should now arrive through Outlook when Fathom sends recap emails with action items.

### First-run backfill guard
Fresh environments now limit first-run ingestion to a short recent window (`FIRST_RUN_LOOKBACK_HOURS`, default `2`) until cursor state exists.

### Trello ✅
Direct REST API. All credentials set. Cards created in CPA list.

### Classifier migration ✅
Classifier now targets OpenAI Responses API with JSON schema output validation.

### Personal-vs-work filtering ✅
- Classifier output now includes `isPersonal`
- Personal/social conversation is treated as out of scope for the CPA work board
- Created cards now record `**Personal:** No` in the description for auditability

---

## Outlook / Teams setup (waiting on IT)

Azure app registered for CPA
- App ID: `fc1f389e-0da7-4ba6-a939-10cbf60feb3f`
- Tenant ID: `2c48a1e6-c525-4a4b-a5b1-b33d91789af7`
- Redirect URI: `http://localhost:3000/auth/callback`
- Permissions requested: `Mail.Read` (delegated), `Chat.Read` (delegated)
- **Pending: IT admin consent at Entra admin centre for the CPA Graph app → Permissions → Grant admin consent**

Once approved, run: `npx tsx scripts/auth-outlook.ts`
Teams ingestion to be built after consent granted.

---

## What needs doing next

### 🟡 Wait for Slack rate limit to recover (evening/tomorrow)
Then run `npm run dev` — should process cleanly.

### 🟡 IT admin consent for Outlook + Teams
Email sent requesting approval for `Mail.Read` + `Chat.Read` delegated permissions.
Once approved: run auth script, build Teams ingestion.

### ⚪ Tune classifier
Review Trello cards after first clean run — adjust confidence thresholds if too noisy or missing tasks.

### ⚪ Production deployment
Currently runs as `npm run dev` (tsx). For always-on, consider:
- Windows Task Scheduler
- PM2 (`pm2 start`)
- Docker container

Current local fallback:
- If the laptop is off at midnight, the midnight sweep does not run
- The next app startup catches up from persisted cursors, but does not force a full Slack DM sweep by default

---

## Key file locations

| What | Where |
|------|-------|
| Slack ingestion | `src/ingestion/slack.ts` |
| Outlook ingestion | `src/ingestion/outlook.ts` |
| Trello client | `src/trello/client.ts` |
| Classification prompt | `src/classification/prompt.ts` |
| Pipeline runner | `src/pipeline/runner.ts` |
| Config | `src/config/index.ts` |
| Cursor state | `state/cursors.json` (gitignored) |
| Credentials | `.env` (gitignored) |
| Outlook auth script | `scripts/auth-outlook.ts` |

---

## Credentials status

| Variable | Status |
|----------|--------|
| `OPENAI_API_KEY` | ⏳ set in local `.env` before runtime |
| `SLACK_ACCESS_TOKEN` | ✅ set (xoxp- user token) |
| `SLACK_DM_EXCLUDELIST` | ✅ set (C05C1CKF7HR, C0AHJA57X55) |
| `TRELLO_API_KEY` | ✅ set |
| `TRELLO_TOKEN` | ✅ set |
| `TRELLO_BOARD_ID` | ✅ set |
| `TRELLO_INTAKE_LIST_ID` | ✅ set |
| `AZURE_TENANT_ID` | ✅ set |
| `AZURE_CLIENT_ID` | ✅ set |
| `AZURE_CLIENT_SECRET` | ✅ set |
| `OUTLOOK_REFRESH_TOKEN` | ⏳ pending IT consent |
