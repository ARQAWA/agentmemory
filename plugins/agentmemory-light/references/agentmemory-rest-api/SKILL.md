---
name: agentmemory-rest-api
description: The agentmemory HTTP REST API surface, the primary protocol for talking to the memory server. Use when calling agentmemory over HTTP, when MCP is unavailable and you need a fallback, or when integrating a host that does not speak MCP.
---

> Applicability: root sessions only. Child sessions never use this skill.
> This skill does not override primary working rules.


HTTP access uses the same configured adapter as MCP. The canonical MCP
`command`, `args`, and `env` in Codex `config.toml` define its endpoint and
proxy; do not assume localhost or configure a second proxy client.

## Quick start

```js
// Run this example in Node. `referencesDirectory` is the absolute path shown
// in the injected `Internal references directory` context.
const { requestHttp } = require(
  require('node:path').join(referencesDirectory, '..', 'scripts', 'hooks.cjs'),
);

await requestHttp('GET', '/agentmemory/livez');
await requestHttp('POST', '/agentmemory/remember', {
  content: 'chose JWT refresh rotation', concepts: ['jwt-refresh-rotation'],
});
await requestHttp('POST', '/agentmemory/smart-search', {
  query: 'auth token strategy', limit: 5,
});
```

## Auth

The launcher uses the configured adapter command, args, proxy, and auth. A
server may restrict available routes; do not bypass those restrictions.

## Conventions

- Save returns `201`, reads return `200`, validation errors return `400`.
- Handlers whitelist body fields and drop unknown ones, so passing extra keys is safe but ignored.
- The port is configurable with `--port` or `--instance`; streams, viewer, and engine derive from it.

## See also

- agentmemory-mcp-tools for the MCP equivalents.
- agentmemory-config for the port quartet and the secret.

## Reference

The full endpoint list with methods lives in REFERENCE.md, generated from `src/triggers/api.ts`.
