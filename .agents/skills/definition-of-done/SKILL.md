---
name: definition-of-done
description: Verify Codex App SDK changes before handoff, commit, push, or declaring work complete. Use for implementation, refactoring, bug fixes, public API changes, Vue components/providers, Node or Electron runtime changes, documentation, samples, packaging, and test work in this repository.
---

# Definition of Done

Apply these gates proportionally to the change. Do not declare work complete while a relevant gate is failing or unexplained.

## 1. Confirm scope and boundaries

- Review `git status --short` before editing and before handoff. Preserve unrelated user changes.
- Keep the SDK Codex-specific. Product shells, provider-neutral orchestration, business data, and non-Codex backends remain host-owned.
- Prefer narrow reusable primitives over host-shaped abstractions.
- Keep production files near or below 500 lines. When a changed file is already larger, avoid growing it and extract a focused controller, composable, helper, or component when practical.

## 2. Preserve public contracts

- Treat exports from package entrypoints as public API.
- Keep Node-only values out of renderer-safe contracts and Electron IPC.
- Keep defaults secure and backward compatible unless the task explicitly changes them.
- For Vue provide/inject APIs, follow `docs/guide/vue-providers.md`:
  - name helpers `provideCodex*` and `useCodex*`;
  - prefix every injection-key description with `codex-app-sdk-`;
  - provide a safe default when configuration is optional;
  - scope configuration to the current Vue tree;
  - export public types from `codex-app-sdk/vue`.

## 3. Test behavior at the right layer

- Add or update focused tests for every behavior change.
- Split large specs by concern instead of adding unrelated cases to an oversized file.
- Use real-browser coverage for contenteditable selection, clipboard, layout, scrolling, or focus behavior that JSDOM cannot represent reliably.
- Update the component lab when a visual state, interaction, or extension point benefits from deterministic human inspection.
- Keep test output free of actionable warnings.

## 4. Update documentation

Update documentation whenever public behavior, API, configuration, security defaults, or extension points change.

- Update `README.md` when the feature affects discovery or the recommended starting path.
- Update the relevant file under `docs/guide/` for usage and design guidance.
- Update the relevant file under `docs/api/` for exported names and exact contracts.
- Add new VitePress pages to `docs/.vitepress/config.mts` and link them from neighboring pages.
- Run `npm run docs:build` whenever VitePress content or navigation changes.

Documentation-only internal refactors do not require unrelated product documentation.

## 5. Run verification

Run the smallest focused test while iterating, then the applicable repository gates before handoff:

```bash
npm test
npm run typecheck
npm run build
```

Also run the affected sample or documentation gates:

```bash
npm run lab:test
npm run lab:typecheck
npm run lab:build
npm run sample:test
npm run sample:build
npm run docs:build
```

Use `npm run test:coverage` for coverage work or when a substantial refactor changes exercised branches. Run `git diff --check` for every change.

## 6. Handoff cleanly

- Summarize the outcome and public API precisely.
- Report tests and builds actually run, including non-failing warnings worth noting.
- Report remaining unrelated worktree changes.
- Do not commit or push unless the user requests it.
