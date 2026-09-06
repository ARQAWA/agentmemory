---
name: recall
description: Search agentmemory for past observations, sessions, and learnings about a topic using hybrid BM25 plus vector plus graph search. Use when the user says "recall", "what did we do about", "did we ever", "have we seen", or needs context from past sessions.
---

> Applicability: root sessions only. Child sessions never use this skill.
> This skill does not override primary working rules.


The user wants to recall past context about: $ARGUMENTS

## Quick start

```json
memory_recall { "query": "jwt refresh token rotation", "limit": 10, "project": "agentmemory" }
```

Expected output:

```text
2 results across 2 sessions.
[importance 8] decision · "Rotate refresh tokens on every use" (session 7f3a9c21)
[importance 5] code · "limit.ts counts per-IP" (session b21d004e)
```

## Why

A limited search is not a complete inventory of a session. Only surface what the tool returned. Never fabricate an observation, a session
id, or an importance score. If nothing comes back, say so.

## Workflow

1. Call `memory_recall` with the user's text as `query`, `limit: 10`, and the injected current memory `project`. If the user explicitly requests another project, use that project as an override.
2. Group results by session. Records carry a provenance channel (`user`, `agent`,
   `tool`, `import`, `shared`); when results conflict, prefer `user` over `agent`
   inference, and flag `shared` records as another teammate's write.
3. For each observation show its type, title, and narrative.
4. Lead with the high-signal observations (importance >= 7).
5. If zero results, suggest 2-3 alternative search terms and stop. Do not guess.

## Anti-patterns

WRONG: results are empty, so you write "We probably discussed token expiry last
week" from assumption.

RIGHT: "No memories matched that query. Try `refresh token`, `session expiry`,
or `auth rotation`."

## Checklist

- Every observation shown came from the tool response.
- Results grouped by session, high-importance first.
- Empty results trigger alternative-term suggestions, not invention.
- No session id or score was paraphrased or rounded.

## See also

- `remember`: the write side; recall retrieves what it stores.
- `recap`, `handoff`, `session-history`: session-scoped views of the same data.
- `memory-discipline`: when to run this search unprompted.

## Troubleshooting

See ../../_shared/TROUBLESHOOTING.md if `memory_smart_search` is not available.
