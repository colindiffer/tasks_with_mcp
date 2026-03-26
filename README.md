CPA (Colin's Personal Assistant)

CPA exists to design, implement, and refine an automated task capture and execution system.

The goal is to reliably detect when work is requested across Slack, Outlook, and Teams chats, classify whether it constitutes an actionable task, and push validated tasks into Trello as the single system of record.

The system must prioritise precision over volume. It should reduce cognitive load, prevent missed commitments, and provide structured visibility over execution without generating noise or unnecessary task clutter.

This project focuses on:

Defining what qualifies as a task

Designing ingestion logic for Slack, Outlook, and Teams chats

Building a classification model with confidence thresholds

Structuring Trello as a clean execution board

Preventing duplication, false positives, and artificial urgency

Establishing review rituals and feedback loops

The outcome should be a stable, low-noise, high-trust task system that scales with increasing responsibility and message volume.

Railway Deployment

This project is now set up to run on Railway as a persistent worker service rather than a cron job.

Recommended Railway setup:

- Service type: persistent service
- Build command: `npm run build`
- Start command: `npm start`
- Volume: attach a single Railway volume to the service, for example mounted at `/data`
- Variable: set `STATE_DIR=/data` or whatever mount path you choose
- Config as code: `railway.json` pins Railpack + build/start commands for deploys

State and token persistence:

- CPA stores source cursors in `cursors.json`
- Microsoft Graph refresh-token rotations are persisted to `outlook-refresh-token.txt`
- on Railway, set `STATE_DIR` to the attached volume mount path so both files persist across restarts
- without a volume, those files live under the repo-local `state/` directory and are lost on redeploy/restart

Minimum Railway variables:

- `SLACK_ACCESS_TOKEN`
- `OPENAI_API_KEY`
- `TRELLO_API_KEY`
- `TRELLO_TOKEN`
- `TRELLO_BOARD_ID`
- `TRELLO_INTAKE_LIST_ID`

Optional but needed for Outlook / Teams:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `OUTLOOK_USER_EMAIL`
- `OUTLOOK_REFRESH_TOKEN`

Optional overrides:

- `STATE_DIR`
- `STATE_FILE`
- `OUTLOOK_TOKEN_FILE`
- `FIRST_RUN_LOOKBACK_HOURS`
- `CRON_SCHEDULE`
- `SLACK_MONITOR_CRON_SCHEDULE`
- `SLACK_FULL_SWEEP_CRON_SCHEDULE`
- `STARTUP_FULL_SWEEP`

First-run behavior:

- if CPA starts with no persisted cursor state, it now limits ingestion to a short recent window instead of scanning the full historical catch-up range
- default first-run window: `FIRST_RUN_LOOKBACK_HOURS=2`
- once cursor state exists, the normal catch-up behavior resumes

Operating Rules
1. System of Record

Trello is the single source of truth for execution.

No parallel task systems.

GitHub Issues are for engineering work only.

Email flags or Slack saves do not count as tasks.

2. Definition of a Task

A task must:

Require an outcome or deliverable

Be directed to Colin explicitly or implicitly

Contain action-oriented language

Be work-related rather than personal/social

Not be informational only

Do not classify as tasks:

FYI messages

General discussions

Open-ended brainstorming

Non-committal commentary

Personal or social conversations, even when they invite a reply

3. Automation Philosophy

Precision over recall.

Missing one low-impact task is acceptable.

Creating noise is not acceptable.

Due dates must only be extracted when explicitly stated.

No invented urgency.

Exception: explicitly configured monitor channels may create rule-based urgent tasks with fixed due windows when Colin has asked for that behaviour.

4. Intake Structure (Trello)

Board: Single master execution board.

Lists:

CPA

Approved

This Week

Waiting On

Done

All automation lands in the CPA list only.

Manual triage is required before work begins.

5. Card Creation Rules

Each Trello card must include:

Clear action-based title (short)

Source (Slack / Email / Meeting)

Requested by

Original message snippet

Direct link to original context

Confidence score

Whether the classifier considered it personal

Due date only if explicitly provided

Exception: user-configured monitor-channel rules may apply an explicit fixed due window set by Colin.

No summarised guesswork that removes context.

6. Confidence Model

High confidence → Auto-create

Medium confidence → Flag for review

Low confidence → Ignore

Confidence must be based on:

Direct mention

Directive verbs

Deadline language

Context continuity

7. Deduplication

Before creating a card:

Check for existing similar open tasks

Avoid duplicate cards from Slack thread replies

Merge context into existing task when appropriate

8. Review Ritual

Daily:

Review CPA

Approve, move, or delete

Ensure This Week list remains realistic

Weekly:

Clear stale intake items

Audit Waiting On

Close completed cards

9. Design Constraint

The system must:

Reduce cognitive friction

Not increase admin overhead

Not require constant supervision

Be explainable and inspectable

If automation becomes noisy, tighten the detection logic rather than widening intake.

10. Instructions For Any LLM Or Coding Assistant

Any model working in this repo must preserve the operating rules above.

Read `README.md`, `PROGRESS.md`, `CODEX_NOTES.md`, and `.github/copilot-instructions.md` before making non-trivial changes.

Do not loosen task-classification rules simply to increase capture volume.

Personal or social conversation should not enter the CPA work board even if it technically needs a reply.

Do not invent due dates, urgency, assignees, field values, or missing context.

Keep Trello as the only automation system of record unless the user explicitly changes that rule.

Keep source scope tight: Outlook should stay Colin-relevant, and Teams should stay chat-only unless explicitly expanded.

Treat unsolicited sales outreach, marketing emails, and generic notifications as default-ignore unless Colin clearly asked for follow-up.

Do not commit `.env`, cursor state, logs, tokens, or other machine-local runtime state.

Do not claim background scheduling is working unless it has been verified with a live process check and current log timestamps.
