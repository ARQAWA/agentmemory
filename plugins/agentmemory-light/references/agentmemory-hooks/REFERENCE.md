# agentmemory hooks reference

The AgentMemory Light plugin uses exactly four root lifecycle events and emits
the internal instruction catalog through their context output:

- `PreCompact`
- `SessionStart`
- `Stop`
- `UserPromptSubmit`

There are no `PostToolUse`, `PostToolUseFailure`, `PreToolUse`, `SessionEnd`,
`SubagentStart`, `SubagentStop`, `TaskCompleted`, `Notification`, or
post-commit hooks. The plugin has no MCP server entry; MCP and HTTP use the
same configured adapter command, args, and environment. Hook context is
emitted by `SessionStart`, `UserPromptSubmit`, and `PreCompact`; `Stop` only
captures the final response and ends the session.

Register the local personal marketplace containing this plugin first, then
add it with `codex plugin add agentmemory-light@personal`.
