---
name: handoff
description: Resume the most recent agent session for the current working directory, leading with any unanswered question. Use when the user says "where were we", "resume", "handoff", "pick up where I left off", or starts a session with no fresh context.
---

> Applicability: root sessions only. Child sessions never use this skill.
> This skill does not override primary working rules.


The user wants to resume work. Optional cwd override: $ARGUMENTS

## Quick start

```json
memory_sessions { "limit": 20 }
```

Pick the most recent session whose `project` matches the injected current memory project, then:
`memory_recall { "query": "<session top concepts>", "limit": 10 }`.

Expected output:

```text
Resuming 7f3a9c2 "Auth refresh rework".
Open question: should logout revoke all device tokens or just the current one?
Next step: decide revoke scope, then update auth/logout.ts.
```

## Why

Match the session by its canonical project field so another project is never selected. Never invent observations for an empty session.

## Workflow

1. Use the injected current memory project unless `$ARGUMENTS` explicitly names
   another project.
2. Call `memory_sessions`. Pick the most recent session whose `project` equals the selected project. Prefer `completed` over `abandoned`.
   If the user explicitly names another project, use that project as an override.
   No match: report no session for that project; do not fall back to another project.
3. If the session ended on an unanswered user-facing question, surface it FIRST.
   Look in `summary` or recent `conversation` observations whose `narrative`
   ends in `?`.
4. Summarize: title/summary, key files, key decisions or errors, using
   `memory_recall` on the top concepts, limit 10, and the current memory project.
5. End with one concrete "next step?" pointer.

## Anti-patterns

WRONG: select the most recent session overall when the selected project has no match.

RIGHT: report no session for that project and do not cross the project boundary.

## Checklist

- Project scope came from the injected identifier or an explicit user override.
- Match used the exact project field.
- Unanswered question (if any) leads the response.
- Empty session is reported plainly, with an offer to start fresh.

## See also

- `recap`, `session-history`, `recall`: same session data, broader views.

## Troubleshooting

See ../../_shared/TROUBLESHOOTING.md if `memory_sessions` or `memory_recall` is not available.
