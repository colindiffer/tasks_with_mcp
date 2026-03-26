# Claude Instructions

Read `README.md`, `PROGRESS.md`, `CODEX_NOTES.md`, and `.github/copilot-instructions.md` before making non-trivial changes.

This project is a precision-first task capture system, not a broad summarisation assistant.

Non-negotiable rules:

- Do not loosen task-classification rules simply to capture more tasks.
- Do not invent due dates, urgency, assignees, field values, or missing context.
- Keep Trello as the single system of record and write automation output only to the CPA intake list unless the user explicitly changes that rule.
- Keep source scope tight: Outlook should stay Colin-relevant, and Teams should stay chat-only unless explicitly expanded.
- Treat unsolicited sales outreach, marketing emails, and generic notifications as default-ignore unless Colin clearly asked for follow-up.
- Do not commit `.env`, `state/cursors.json`, logs, tokens, or other machine-local runtime state.
- Do not claim background scheduling is working unless it has been verified with a live process check and current log timestamps.

When architecture, runtime expectations, or operating rules materially change, update `PROGRESS.md` and `CODEX_NOTES.md`.
