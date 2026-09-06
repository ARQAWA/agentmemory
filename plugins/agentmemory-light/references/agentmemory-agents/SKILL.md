---
name: agentmemory-agents
description: Reference for how agentmemory wires into host coding agents via connect. It does not register child agents or transfer memory to them.
---

> Applicability: root sessions only. Child sessions never use this skill.
> This skill does not override primary working rules.


This reference describes how `agentmemory connect <agent>` merges the memory server into a host agent's config and preserves existing servers. REST is the underlying protocol; for MCP-only hosts the adapter wires the stdio MCP bridge.

## Quick start

```bash
agentmemory connect claude-code   # or cursor, codex, gemini-cli, ...
```

After wiring, restart the host or run its MCP reload (for example `/mcp` in Claude Code) so it picks up the server. Then confirm the agent lists agentmemory's tools.

## Workflow

1. Detect the calling agent. If unknown, default to `claude-code`.
2. Run `agentmemory connect <name>` using a name from the table in REFERENCE.md.
3. Verify: the host should show the full tool set with a server running. Only 7 tools means the MCP shim could not reach a server (see ../../_shared/TROUBLESHOOTING.md).

## Notes

- The action instructions are included in this personal plugin and loaded through the hook context, not shown as registered skills. After registering the local personal marketplace, add it with `codex plugin add agentmemory-light@personal`. `connect` makes the separately configured memory server available; skills teach the agent when to use it.
- Windows: use WSL2. Native Windows runs the server but `connect` is not supported there.

## See also

- agentmemory-mcp-tools, agentmemory-rest-api, agentmemory-hooks.

## Reference

The full adapter list with display names and protocol notes lives in REFERENCE.md, generated from `src/cli/connect/`.
