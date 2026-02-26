# Progress Log

## Status: MCP servers connected, pipeline code needs rebuilding

---

## What's done

### MCP Servers — all three connected ✅

| Server | Status | Config |
|--------|--------|--------|
| Fathom | ✅ connected | `node C:/Users/ColinDiffer/mcp-fathom-server/dist/index.js` |
| Trello | ✅ connected | `cmd /c npx -y @delorenj/mcp-server-trello` |
| Slack  | ✅ connected | `https://mcp.slack.com/mcp` (OAuth) |

All registered in `C:\Users\ColinDiffer\.claude.json` under project `C:/Users/ColinDiffer/internal_projects/tasks_with_mcp`.

### Credentials stored in .claude.json (not .env)
- `TRELLO_API_KEY` + `TRELLO_TOKEN` — non-expiring token
- `FATHOM_API_KEY` — in MCP config
- Slack — OAuth token managed by Claude Code automatically

### Fathom MCP server
- Cloned to `C:\Users\ColinDiffer\mcp-fathom-server\`
- Built (`npm install && npm run build`)
- Exposes two tools: `list_meetings`, `search_meetings`
- Source: https://github.com/sourcegate/mcp-fathom-server

### Trello MCP server
- Runs via `npx @delorenj/mcp-server-trello` (no local clone needed)
- Source: https://github.com/delorenj/mcp-server-trello
- Note: Windows requires `cmd /c` wrapper — already configured

### TypeScript project scaffolded
- All source files in `src/` — types, config, ingestion, classification, trello, pipeline, webhook
- **BUT**: currently written for direct API calls (Slack Web API, Trello REST)
- Needs to be **rewritten to call MCP tools** via Anthropic API tool_use pattern

---

## What's next

### Immediate: rebuild the pipeline to use MCP tools

The architecture has changed from "standalone service with direct APIs" to "Claude-orchestrated pipeline using MCP tools". The `src/` code needs to be replaced with a new approach:

1. **Trigger**: `src/index.ts` — keep the cron scheduler
2. **Ingestion**: instead of calling Slack/Trello APIs directly, invoke Claude (Anthropic API) with MCP tools available — Claude calls `slack_list_channels`, `slack_get_channel_messages` etc.
3. **Classification**: Claude does this natively as part of the same agent loop
4. **Output**: Claude calls `trello_add_card_to_list` via the Trello MCP tool

This means the pipeline becomes a **Claude agent invocation** rather than direct API calls.

### Slack — find the right channel IDs
- Need to identify which Slack channels to monitor
- Use the Slack MCP `list_channels` tool to discover them

### Trello — find the AI Intake list ID
- Use Trello MCP `list_boards` then `get_lists` to get the ID of the "AI Intake" list
- Add `TRELLO_INTAKE_LIST_ID` to the MCP config or a config file

### Outlook — not yet started
- No MCP available
- Options: Microsoft Graph API (Azure app needed) or skip for now
- The old `fathom-pipeline` project at `C:\Users\ColinDiffer\app\fathom-pipeline` has Azure setup notes in its README but is untested

---

## Key file locations

| What | Where |
|------|-------|
| MCP config | `C:\Users\ColinDiffer\.claude.json` → projects → tasks_with_mcp → mcpServers |
| Fathom MCP server | `C:\Users\ColinDiffer\mcp-fathom-server\` |
| This project | `C:\Users\ColinDiffer\internal_projects\tasks_with_mcp\` |
| TypeScript source | `src/` — needs rewrite for MCP-based approach |
| Operating rules | `README.md` |
