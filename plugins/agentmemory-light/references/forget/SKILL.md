---
name: forget
description: Delete specific saved memories from agentmemory after showing them and getting explicit confirmation. Use when the user says "forget this", "delete memory", "remove that note", or wants to scrub specific data for privacy.
---

> Applicability: root sessions only. Child sessions never use this skill.
> This skill does not override primary working rules.


The user wants to remove saved memory from agentmemory: $ARGUMENTS

## Quick start

```json
memory_recall { "query": "old api key in config", "limit": 20, "project": "<current memory project>" }
```

Show the matches, get a yes, then:

```json
memory_governance_delete { "memoryIds": "abc12345,def67890", "reason": "user privacy request" }
```

Expected output:

```text
Found 2 matching memories. Confirmed. Deleted 2 memories.
```

## Why

This is destructive and irreversible. Show exactly what will be deleted and get
an explicit yes before calling delete. Delete by memory ID, never a bare session. This MCP deletes saved `mem_` records only; observation records (`obs_`) are not deleted by it. Do not pass `obs_` ids or report that they were deleted.

## Workflow

1. Search with `memory_recall`, the user's text as `query`, `limit: 20`, and the injected current memory `project`.
2. Show what matched: session ids, memory ids, titles. Ask for explicit
   confirmation. Do not proceed on silence or a vague "sure, whatever".
3. On confirmation, call `memory_governance_delete` with `memoryIds` as a comma-separated string and optional `reason` (default `plugin skill request`).
4. Do not treat a limited search as a full inventory of a session; only delete the exact ids shown and confirmed. The MCP does not accept a bare `sessionId`. `memory_governance_delete` removes saved `mem_` records only; observation `obs_` records require the separate session cleanup path and are outside this MCP action.
5. Lessons are separate: delete one with `memory_lesson_delete` and its
   `lessonId`; `memory_governance_delete` does not touch lessons.
6. Report the deletion count back. A count of 0 means the ids did not exist;
   say so instead of claiming a delete.

## Anti-patterns

WRONG: search returns matches, you immediately call `memory_governance_delete`
without showing them or waiting for a yes.

RIGHT: list the matches, ask "Delete these 2? (yes/no)", and only delete after
an explicit yes.

## Checklist

- Matches were shown to the user before any delete.
- Only saved `mem_` records were targeted; `obs_` records were not reported as deleted.
- An explicit yes was received, not assumed.
- `memoryIds` holds real ids from the search, never a bare `sessionId`.
- Final message states the actual count deleted.

## See also

- `remember`: the write side; forget is its undo.
- `recall`: find the exact memory id before deleting.

## Troubleshooting

See ../../_shared/TROUBLESHOOTING.md if `memory_smart_search` or `memory_governance_delete` is not available.
