# AgentMemory Light internal instruction catalog

Root-only. Current user instructions, order, and scope remain primary;
authoritative code sources remain primary for code facts. Choose a matching topic
by the meaning of the current user request or relevant in-scope task, then read
that `SKILL.md` before following it. These files are internal references, not
registered skills. `$ARGUMENTS` in preserved documents means the user's
natural-language request or explicit parameters, never literal text. There is
no first-tool mandate and no automatic extra work. Do not pass this catalog,
these instructions, or recalled context to child agents.

Use the existing adapter for ordinary `memory_*` MCP calls. For explicit HTTP
access, use `requestHttp` exported by `scripts/hooks.cjs`; it launches that
same adapter. Do not use direct fetch, curl, or another proxy client.

- `remember/SKILL.md` — Use when saving a settled fact or decision at the user's request.
- `recall/SKILL.md` — Use when searching past context relevant to a query.
- `forget/SKILL.md` — Use when explicitly deleting memory with exact confirmation.
- `lesson/SKILL.md` — Use when retaining a user correction worth remembering.
- `memory-discipline/SKILL.md` — Use when deciding whether recall or save is appropriate.
- `handoff/SKILL.md` — Use when resuming previous work.
- `recap/SKILL.md` — Use when summarizing a requested time window.
- `session-history/SKILL.md` — Use when reviewing previous sessions.
- `commit-context/SKILL.md` — Use when asking why code or a commit exists.
- `commit-history/SKILL.md` — Use when listing agent-linked commits.
- `agentmemory-hooks/SKILL.md` — Use when debugging automatic capture or context.
- `agentmemory-agents/SKILL.md` — Use when setting up host connection.
- `agentmemory-config/SKILL.md` — Use when changing server settings.
- `agentmemory-mcp-tools/SKILL.md` — Use when checking tool names or parameters.
- `agentmemory-rest-api/SKILL.md` — Use when accessing the HTTP API.
- `agentmemory-architecture/SKILL.md` — Use when understanding memory internals.
- `write-agentmemory-skill/SKILL.md` — Use when editing internal instructions.
