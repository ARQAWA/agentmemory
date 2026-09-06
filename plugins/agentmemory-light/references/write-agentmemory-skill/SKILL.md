---
name: write-agentmemory-skill
description: The house format and rules for writing or updating an internal agentmemory instruction. Use when adding, restructuring, or reviewing an instruction for consistency.
---

> Applicability: root sessions only. Child sessions never use this skill.
> This skill does not override primary working rules.


AgentMemory internal instructions follow one tiered format so they stay skimmable, accurate, and current. Match it exactly.

## Directory layout

```text
plugins/agentmemory-light/references/<name>/
  SKILL.md      (required, under 100 lines)
  REFERENCE.md  (optional, dense facts; auto-generate data tables)
  EXAMPLES.md   (optional, worked transcripts)
```

## SKILL.md rules

- Frontmatter: `name` and `description` are documentation metadata only. Do not add `user-invocable`, slash-command, or registration fields.
- Description states the capability and concrete triggers. The short descriptor in `references/INDEX.md` selects the document by meaning; frontmatter is not a menu entry.
- Body order: Quick start (one concrete example), Why (the governing principle), Workflow (numbered steps with decision gates), Anti-patterns (a WRONG vs RIGHT callout for the top mistake), Checklist, See also (cross-link siblings), Reference or Troubleshooting pointer.
- Stay under 100 lines. Move dense facts to REFERENCE.md and examples to EXAMPLES.md.
- Cross-references link one level deep only. Shared recovery steps live in `../../_shared/TROUBLESHOOTING.md`, never inlined.

## Keep it current

This plugin keeps internal instructions under `plugins/agentmemory-light/references/<name>/SKILL.md` with frontmatter as documentation metadata; it does not register slash skills. The actual selection catalog is `references/INDEX.md`. Update `INDEX.md` when adding or renaming an instruction. Upstream generators do not maintain this internal catalog.

## Style

No external or competitor product names. No emojis. No em-dashes. No filler. State the thing and stop.

## Checklist

- Description has a "Use when" sentence with real triggers.
- SKILL.md is under 100 lines.
- No time-sensitive claims and no duplicated troubleshooting block.
- Concrete example present; facts and references match the current source.
- Cross-links resolve and go one level deep.
