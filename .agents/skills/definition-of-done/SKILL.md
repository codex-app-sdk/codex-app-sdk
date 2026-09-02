---
name: definition-of-done
description: Verify Codex App SDK work before handoff, commit, or push. Use after repository changes.
---

# Definition of Done

Use proportional evidence. The user's requested validation depth is authoritative.

## Before handoff

- Inspect `git status --short`; preserve unrelated changes.
- Add focused tests for behavior changes. Use browser coverage for selection,
  clipboard, layout, scrolling, or focus behavior that JSDOM cannot prove.
- Prefer the affected package or workspace `check` script: it owns lint, tests,
  and build. Use `npm run check:sdk` for cross-package SDK changes and
  `npm run check` for broad changes or requested full validation.
- Build relevant consumers when package exports or distributable output change.
- Use `npm run test:ai` only when broad tests are wanted without other gates.
- Run `git diff --check` after the final edit.

## VitePress gate

Treat VitePress as a public SDK surface. For every change, decide and report one:

- **Updated:** public API, behavior, configuration, defaults, extension points,
  or recommended workflows changed. Update `docs/api/` for exact contracts,
  `docs/guide/` for usage, and `README.md` only for discovery. Update
  `docs/.vitepress/config.mts` when pages move or are added, then run
  `npm run build:docs`.
- **No impact:** state why the change is internal.

A public contract change is incomplete until its VitePress documentation matches.

## Report

Summarize the outcome and public API, checks actually run, VitePress impact, and
remaining unrelated changes. Explain selected failures or warnings. Commit or
push only when requested.
