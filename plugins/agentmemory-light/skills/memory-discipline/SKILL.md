---
name: memory-discipline
description: "The session loop that makes AgentMemory useful: recall relevant prior decisions when useful, save settled decisions with reasons, and learn from corrections. Use when starting a nontrivial task, after settling a decision or debugging a gotcha, or whenever deciding if something belongs in memory."
---

> Applicability: root sessions only. Child sessions never use this skill.
> This skill does not override primary working rules.


Memory is useful when relevant prior decisions are recalled at the right time and settled decisions are saved with reasons. Keep the current request, order, and graph authority primary; each memory call is mechanical.

## Quick start

```json
memory_recall { "query": "auth refresh flow", "limit": 5 }
```

when prior decisions are useful for the current task, then at each settled decision:

```json
memory_save { "content": "Chose cursor pagination over offset; offset scans broke past 100k rows in db/list.ts.", "concepts": "cursor-pagination, offset-scan-limit", "files": "src/db/list.ts" }
```

## Why

Hooks capture what happened automatically. What they cannot capture is judgment: which fact mattered, which decision was settled, which correction should change future behavior. That judgment applied at the right moments is this discipline.

## Workflow

1. When relevant prior decisions could affect the current task, use `memory_recall` with the task topic. Use it when useful, while following the current request, order, and graph authority; there is no first-tool requirement.
2. Mid-task, the moment a decision settles or a gotcha resolves: `memory_save` with the decision AND the reason, 2-5 specific concepts, real file paths. Save at the moment of resolution; end-of-session batch saves lose the reasons.
3. On user correction of your approach: save a lesson instead of a memory (the `lesson` skill). Lessons carry confidence and resurface before similar work; memories carry facts.
4. Before repeating a task type you have been corrected on: `memory_lesson_recall` with the task type as query.
5. Session end: stop. Hooks summarize and consolidate; a manual recap save duplicates them.

## What qualifies

Save: settled decisions with reasons, non-obvious constraints discovered by debugging, environment facts not derivable from the repo. Skip: anything readable from the code, transient state, secrets, and step-by-step narration (hooks already captured it).

## Anti-patterns

Avoid indiscriminate end-of-task searches or batch recaps. Recall when the current task benefits from prior decisions, save each settled decision with its reason, and let hooks own the summary.

## Checklist

- Prior decisions were recalled when relevant, without a fixed first-tool rule.
- Every save carries the reason, not just the conclusion.
- Corrections became lessons, not memories.
- Nothing saved that the repo or hooks already record.

## See also

- `recall`, `remember`: the user-invoked forms of the read and write sides.
- `lesson`: the correction loop this discipline hands off to.

## Troubleshooting

See ../../_shared/TROUBLESHOOTING.md if `memory_recall` or `memory_save` is not available.
