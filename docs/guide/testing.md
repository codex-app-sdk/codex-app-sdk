# Testing policy

Tests must protect observable SDK behavior. Test count and coverage are
constraints, not goals.

## Value gate

For every test added or kept, identify:

1. the production regression it prevents;
2. the externally observable contract that proves the regression;
3. why an existing test does not already cover that risk.

Prove the test red under the defect, missing behavior, or an intentional
mutation before accepting it green. If the value gate cannot be met, improve an
existing test or remove the new one.

## Test the boundary

Use the smallest layer that observes the real contract. For app-server
translation, drive the schema-typed `MockCodexAppServer` through the real
`CodexAppServerClient`, adapters, controllers, replicas, and surfaces. Assert
the outbound JSON-RPC shape and the public TypeScript result of inbound
responses or events, including ordering, identity, concurrency, and cleanup
when relevant.

The mock is a programmable fixture, not a second product. App-server internals
outside its emitted protocol are not SDK contracts. Boundary call assertions
are appropriate when the call is the public wire or host contract; SDK-internal
call assertions should become observable-result assertions.

For Vue, interact through the public DOM and assert rendered or accessible
state, emitted events, focus, and enabled actions. Use browser evidence for
selection, clipboard, scrolling, layout, and other behavior JSDOM cannot prove.

## Put checks in the right tool

Tests must never read committed implementation or configuration files to assert
their text or source structure. This includes manifests, npm scripts, source
files, imports, CSS, and filenames. Test observable behavior instead; enforce
structural rules through executable compiler, lint, build, pack, or release
validation.

The only file-content exception is output created by the system under test. A
scaffolder may therefore assert the temporary `package.json` or source files it
generates.

## Completion

A test change is done when the claimed regression was red, the public boundary
is green, no existing scenario proves the same risk, coverage remains above its
current thresholds without filler, and the affected `check` command passes.
