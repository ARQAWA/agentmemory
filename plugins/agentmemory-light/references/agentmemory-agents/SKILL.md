---
name: agentmemory-agents
description: Reference for how agentmemory wires into host coding agents via connect. It does not register child agents or transfer memory to them.
---

> Applicability: root sessions only. Child sessions never use this skill.
> This skill does not override primary working rules.


This reference describes the existing Codex global `mcp_servers.agentmemory`
`command`, `args`, and `env` transport. Do not run an upstream `agentmemory
connect` command over this configured adapter. Other hosts are described in
REFERENCE.md for reference only.

## Quick start

```bash
Read the existing Codex `mcp_servers.agentmemory` entry and restart the host
after changing it. Do not create a second daemon or MCP connection.
```

After wiring, restart the host or run its MCP reload (for example `/mcp` in Claude Code) so it picks up the server. Then confirm the agent lists agentmemory's tools.

## Workflow

1. Read the canonical Codex MCP `command`, `args`, and `env`.
2. Verify that the host lists AgentMemory tools through that existing adapter.
3. If unavailable, check the configured command and restart the host after a
   configuration change (see ../../_shared/TROUBLESHOOTING.md).

## Notes

- The action instructions are included in this personal plugin and loaded through the hook context, not shown as registered skills. The existing Codex MCP entry makes the configured memory server available.
- Windows: use WSL2. Native Windows runs the server but `connect` is not supported there.

## See also

- agentmemory-mcp-tools, agentmemory-rest-api, agentmemory-hooks.

## Reference

The full adapter list with display names and protocol notes lives in REFERENCE.md, generated from `src/cli/connect/`.
