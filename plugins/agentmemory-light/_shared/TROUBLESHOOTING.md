# Troubleshooting AgentMemory Light

These steps support the internal AgentMemory references and root hook context.
Light does not register an MCP server. The existing global
`mcp_servers.agentmemory` entry in Codex `config.toml` provides the connection.

## MCP unavailable

If a `memory_*` tool does not appear:

1. Check the existing `mcp_servers.agentmemory` command and args in Codex
   `config.toml` without changing unrelated settings.
2. Confirm the server is enabled and has a live connection in the host.
3. Restart the host after changing that MCP configuration.

Do not automatically reinstall the backend or other plugins.

## REST fallback

Use REST only when the user explicitly asks for HTTP access. Call the
`requestHttp` launcher from `scripts/hooks.cjs`; it uses the configured MCP
command, args, proxy, and auth. Do not call HTTP directly or assume localhost.

Endpoint map by skill:

| Skill           | REST call                                                        |
| --------------- | --------------------------------------------------------------- |
| remember        | `POST /agentmemory/remember`                                     |
| recall          | `POST /agentmemory/smart-search`                                 |
| recap           | `GET /agentmemory/sessions` + `POST /agentmemory/smart-search`   |
| handoff         | `GET /agentmemory/sessions` + `POST /agentmemory/smart-search`   |
| session-history | `GET /agentmemory/sessions`                                      |
| commit-context  | `GET /agentmemory/session/by-commit?sha=<sha>`                   |
| commit-history  | `GET /agentmemory/commits` (URL-encode every query param)       |
