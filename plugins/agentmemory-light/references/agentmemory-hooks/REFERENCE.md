# agentmemory hooks reference

The AgentMemory Light plugin uses exactly four root lifecycle events and emits
the internal instruction catalog through their context output:

- `PreCompact`
- `SessionStart`
- `Stop`
- `UserPromptSubmit`

There are no `PostToolUse`, `PostToolUseFailure`, `PreToolUse`, `SessionEnd`,
`SubagentStart`, `SubagentStop`, `TaskCompleted`, `Notification`, or
post-commit hooks. The plugin has no MCP server entry; it uses the existing
AgentMemory REST routes through the separately configured MCP bridge.

Register the local personal marketplace containing this plugin first, then
add it with `codex plugin add agentmemory-light@personal`.
