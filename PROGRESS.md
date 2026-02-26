# Progress Log

## Status: Pipeline running — Slack needs user token upgrade

---

## What's working

### MCP Servers — all three connected ✅

| Server | MCP Package | Auth |
|--------|-------------|------|
| Slack  | `mcp-server-slack` (local stdio) | `SLACK_ACCESS_TOKEN` |
| Trello | `@delorenj/mcp-server-trello` (local stdio) | `TRELLO_API_KEY` + `TRELLO_TOKEN` |
| Fathom | `node .../mcp-fathom-server/dist/index.js` (local stdio) | `FATHOM_API_KEY` |

### Pipeline architecture ✅
```
cron → pipeline/runner.ts
  ├── MCP (mcp-server-slack)          → fetch Slack messages
  ├── MCP (mcp-fathom-server)         → fetch meetings (polling, not webhooks)
  ├── Anthropic API                   → classify each message
  ├── MCP (@delorenj/mcp-server-trello) → dedup check + create card
  └── state/cursors.json              → cursor tracking per source
```

### Trello board configured ✅
- **Board**: Analytics & Paid Media Tagging Ticket Workflow
- **Board ID**: `66336c384861f3b858dd7371`
- **AI Intake list ID**: `69a0c736ec34ab519b0d42b2`

### .env credentials status
| Variable | Status |
|----------|--------|
| `ANTHROPIC_API_KEY` | ✅ set |
| `TRELLO_API_KEY` | ✅ set |
| `TRELLO_TOKEN` | ✅ set |
| `TRELLO_BOARD_ID` | ✅ `66336c384861f3b858dd7371` |
| `TRELLO_INTAKE_LIST_ID` | ✅ `69a0c736ec34ab519b0d42b2` |
| `FATHOM_API_KEY` | ✅ set — fetching meetings successfully |
| `SLACK_ACCESS_TOKEN` | ⚠️ bot token — needs upgrading to user token |
| `SLACK_CHANNEL_IDS` | ⚠️ placeholder values — will be removed after Slack upgrade |

---

## What's next

### 🔴 Step 1: Upgrade Slack to user token (for DMs + @mentions)

The current `SLACK_ACCESS_TOKEN` is a bot token (`xoxb-`). Bot tokens cannot access
personal DMs or Slack's search API. A user token (`xoxp-`) is needed.

**Steps:**
1. Go to https://api.slack.com/apps — open your Slack app
2. Go to **OAuth & Permissions** → scroll to **User Token Scopes**
3. Add these scopes:
   - `channels:history`, `channels:read`
   - `groups:history`, `groups:read`
   - `im:history`, `im:read`     ← direct messages
   - `mpim:history`, `mpim:read` ← group DMs
   - `search:read`               ← @mention search
   - `users:read`
4. Click **Reinstall App** at the top of the OAuth & Permissions page
5. Copy the **User OAuth Token** (starts `xoxp-...`)
6. Paste into `.env`: `SLACK_ACCESS_TOKEN=xoxp-...`

### 🔴 Step 2: Update Slack ingestion for DMs + mentions

Once the user token is in place, update `src/ingestion/slack.ts` to:
- **Mentions**: use `slack_search_messages` with query `@colin` (or `<@USERID>`)
  — catches all mentions across every channel, no hardcoded channel list
- **DMs**: use `slack_list_channels` with `types: "im,mpim"` to auto-discover
  all DM conversations, then `slack_get_messages` on each

Also remove `SLACK_CHANNEL_IDS` from `.env` and `src/config/index.ts` — no longer needed.

### 🟡 Step 3: Run full end-to-end test
```
npm run dev
```
Expected: Slack messages + DMs fetched, Fathom meetings classified, Trello cards
created in AI Intake list.

### ⚪ Step 4: Outlook (optional / later)
No Outlook MCP exists yet. The pipeline gracefully skips it if `AZURE_TENANT_ID`
is not set. Pick up if/when needed.

---

## Key file locations

| What | Where |
|------|-------|
| MCP client manager | `src/mcp/clients.ts` |
| Slack ingestion | `src/ingestion/slack.ts` |
| Fathom ingestion | `src/ingestion/fathom.ts` |
| Classification prompt | `src/classification/prompt.ts` |
| Cursor state | `state/cursors.json` (gitignored) |
| Credentials | `.env` (gitignored) |
| Fathom MCP server | `C:\Users\ColinDiffer\mcp-fathom-server\` |
| Operating rules | `README.md` |