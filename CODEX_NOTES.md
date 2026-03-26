# Codex Notes

This repo is intended to be runnable and maintainable from Codex without relying on Claude-specific project memory.

## Current classifier runtime

- The pipeline classifier lives in `src/classification/classifier.ts`.
- It uses the OpenAI Responses API over plain `fetch`.
- Required env var: `OPENAI_API_KEY`.
- Optional env var: `OPENAI_MODEL` with default `gpt-4.1-mini`.
- Output is constrained with a JSON schema and then validated again with Zod before the rest of the pipeline sees it.

## Architecture summary

- `src/index.ts`: startup + cron scheduling + overlap guard.
- The normal pipeline runs on `CRON_SCHEDULE` and monitored Slack root-post checks run separately on `SLACK_MONITOR_CRON_SCHEDULE`.
- `src/pipeline/runner.ts`: source fetch -> classify -> dedup -> Trello create.
- `ClassificationResult` now includes `isPersonal` so personal/social requests can be excluded from the work board.
- Trello card titles are prefixed with source, e.g. `Slack: ...`, `Email: ...`, `Teams: ...`.
- `src/ingestion/slack.ts`: user-token Slack mentions + DMs.
- Root posts in configured monitor channels (default `#gtm_monitor_checks`) are also discovered via Slack search and bypass the classifier as urgent 24-hour tasks.
- On first run, monitor-channel checks look back 24 hours by default so recent posts are captured without pulling a full historical backlog; `BACKFILL_SINCE` can still override this for explicit replays.
- Normal Slack runs scan @mentions plus already-known DM threads, which keeps the 15-minute job fast.
- Slack messages authored by Colin himself are skipped before classification, and short same-sender conversation bursts in the same Slack DM/thread are collapsed into one classification unit to avoid multiple cards from one chat.
- Startup full sweeps are optional and default off. A full Slack DM sweep can be extremely slow on large accounts because each DM history request is throttled.
- Bounded replays or `SLACK_FULL_DM_SWEEP=true` trigger full DM conversation discovery plus paginated DM history.
- The app also schedules a daily midnight full Slack DM + Teams chat discovery sweep via `SLACK_FULL_SWEEP_CRON_SCHEDULE` (default `0 0 * * *`).
- The app also schedules a lightweight Slack monitor poll via `SLACK_MONITOR_CRON_SCHEDULE` (default `*/5 * * * *`) that only checks configured monitor channels for new root posts.
- `src/ingestion/outlook.ts`: Graph API via delegated OAuth refresh token. Fathom recap emails are handled through Outlook, with Colin-assigned action items surfaced before classification.
- `src/ingestion/teams.ts`: Microsoft Graph Teams chat ingestion only. No Teams activity feed and no channel posts.
- `BACKFILL_SINCE` and `BACKFILL_UNTIL` can be used for bounded one-off replays without relying only on persisted cursors.
- `src/dedup/deduplicator.ts`: Trello title overlap dedup.
- Dedup now checks both generated title overlap and original-message snippet overlap against existing card descriptions.
- `src/feedback/rules.ts`: loads negative feedback examples from the `AI Feedback` Trello list.
- `src/trello/field-matcher.ts`: matches Trello field suggestions such as `Client` and `Request Type` from message content.
- `src/trello/client.ts`: direct Trello REST integration.
- `src/state/store.ts`: cursor persistence in the configured state path.
- `src/state/paths.ts`: resolves local vs deployed state/token file paths.

## Important operating rules

- Precision over recall.
- Low confidence always skips.
- Personal/social conversation always skips, even if it would otherwise require a reply.
- Due dates must only be captured when explicitly stated.
- All automation writes only to the Trello CPA list.
- Outlook mail should only be considered if `colin@propellernet.co.uk` is in `To` or `Cc`.
- `SLACK_MONITOR_THREAD_CHANNELS` is an explicit user-configured exception to the usual "no invented urgency" rule: new root posts in those channels create urgent cards with a 24-hour due time.
- Outlook ingestion must follow Graph `@odata.nextLink` pagination so later emails are not silently skipped.
- Outlook sender display names can be blocklisted directly; `Bing Ads Service` is currently excluded before classification.
- Teams chat ingestion uses delegated Graph scopes `Chat.Read` and `ChatMessage.Read` in addition to `Mail.Read`.
- If the refresh token predates Teams support, rerun `npx tsx scripts/auth-outlook.ts` so the token includes the Teams scopes.
- Unsolicited sales outreach should not become tasks. Cold pitches such as free audits, demos, white-label offers, and vendor prospecting are skipped unless Colin explicitly asked for them.
- Personal/social conversation such as weekend plans, marathon chat, races, holidays, family logistics, and hobby conversation should be treated as out of scope for the CPA work board.
- This board uses the Amazing Fields Power-Up rather than native Trello custom fields. The automation can match field values, but with the current Trello user-token integration it can only write those matches into the card description, not into the Amazing Fields UI itself.
- `AI Feedback` Trello list ID is stored in `TRELLO_FEEDBACK_LIST_ID` for future feedback-rule ingestion.
- Feedback cards marked with Amazing Fields `Issue` values such as `Spam`, `Sales outreach`, `Duplicate`, or `Should have been ignored` are treated as negative examples for future suppression.
- `state/cursors.json`, `state/outlook-refresh-token.txt`, and `.env` are local runtime state and should not be committed.
- For Railway, run this as a persistent service, attach a volume, and set `STATE_DIR` to the volume mount path.
- If the laptop is off overnight, catch-up relies on the next startup run plus persisted cursors; midnight cron will not fire while the machine is off.
- Do not enable startup full sweeps by default unless the account size and API rate limits have been checked first.

## Instructions for any LLM working here

- Treat this file, `README.md`, `PROGRESS.md`, and `.github/copilot-instructions.md` as project memory that must be read before making non-trivial changes.
- Preserve the core product rule: this system is precision-first task capture, not a broad summarisation or inbox-zero assistant.
- Do not loosen classification rules just to capture more tasks. If automation is noisy, tighten logic.
- Do not invent due dates, urgency, assignees, client values, or missing context.
- Keep Trello as the single system of record and write automation output only to the CPA intake list unless the user explicitly changes that rule.
- Keep Outlook filtering strict: only process mail relevant to Colin directly, and keep Teams limited to chats unless the user explicitly expands scope.
- Treat unsolicited sales outreach, marketing emails, and generic notifications as default-ignore unless Colin clearly asked for follow-up.
- Keep `PROGRESS.md` and this file updated when architecture, runtime expectations, credentials requirements, or operating rules materially change.
- Do not commit `.env`, `state/cursors.json`, logs, tokens, or other machine-local runtime state.
- Before claiming the scheduler is working in the background, verify with a live process check and fresh log timestamps rather than assuming startup succeeded.

## Project-local instructions

- Repo instructions for coding assistants are in `.github/copilot-instructions.md`.
- Claude local permissions remain in `.claude/settings.local.json` for reference only.
- This file exists so Codex/OpenAI-specific setup notes also stay inside the project folder.
