---
name: agentmemory-hooks
description: AgentMemory Light root hooks for automatic prompt, stop, session-start, and pre-compact capture. Use when explaining capture or debugging missing observations.
---

> Applicability: root sessions only. Child sessions never use this skill.
> This skill does not override primary working rules.

AgentMemory Light uses four native lifecycle hooks for root sessions:
`SessionStart`, `UserPromptSubmit`, `Stop`, and `PreCompact`. The hooks run
Node.js 20 or newer from this plugin and require an existing AgentMemory MCP transport.
They reject child-agent provenance before any network request.

## Install

Register the local personal marketplace that contains this repository first,
then add the plugin. Configure the existing AgentMemory MCP server separately;
the plugin has no MCP server of its own.

```bash
codex plugin add agentmemory-light@personal
```

## Capture behavior

- `SessionStart` registers `{sessionId, project, cwd}` and may inject bounded,
  untrusted context from the existing REST route.
- `UserPromptSubmit` sends only cleaned prompt prose to `/agentmemory/observe`.
- `Stop` sends the cleaned final answer in the backend-supported shape:
  `hookType: post_tool_use`, `tool_name: assistant_final`,
  `tool_input.source: primary_assistant_final`, and `tool_output`.
  It ends the session only after that observation succeeds.
- `PreCompact` requests bounded context from `/agentmemory/context`.

The hooks do not capture tool logs, post-commit events, or child-agent events.
They do not create local storage or call an LLM. The MCP bridge remains a
separate REST-backed connection; the hooks use the existing `/agentmemory/*`
REST routes through that transport.

## Safety

Captured text is filtered for service wrappers, XML-like blocks, fenced tool or
review packets, and untrusted memory markers. Errors exit quietly so a hook
cannot block the host turn.

See `REFERENCE.md` for the exact four registered events.
