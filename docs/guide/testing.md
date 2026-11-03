# Testing policy

Tests must protect observable SDK behavior. Test count and coverage are
constraints, not goals.

## Value gate

For every test added or kept, identify:

1. the production regression it prevents;
2. the externally observable contract that proves the regression;
3. why an existing test does not already cover that risk.

The test should survive an equivalent implementation, harmless rewording, or
file move. Prefer a meaningful workflow or state transition over a call-through
check; after a mutation, observe its result through a read, event, rendered
state, persistence check, or cleanup. Do not repeat the same contract at every
layer: give its detailed assertion to the closest owner and use only a distinct
integration risk to justify another test.

A test that still passes when the owner always returns one constant result does
not prove its claimed behavior. Use table cases for distinct mappings, not to
inflate the case count.

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
call assertions should become observable-result assertions. Mock external
boundaries, not SDK logic; when the full public payload is the contract, assert
its complete shape rather than cherry-picking fields. Keep fixtures independent
and clean up streams, processes, and subscriptions in `finally`.

For Vue, interact through the public DOM and assert rendered or accessible
state, emitted events, focus, and enabled actions. For CSS behavior, mount the
real component with production styles and assert computed behavior on its
rendered elements; use a real browser for layout geometry or other behavior
JSDOM cannot prove, such as selection, clipboard, and scrolling. Loading a
stylesheet into the test document is setup, not an assertion on its source text.

Vue tests and browser test helpers must not use fixed real-time waits, including
`sleep`, Playwright `waitForTimeout`, or promises resolved by timer delays
(including zero-millisecond timers). Wait for observable DOM, layout, resource,
or host events instead. Use deferred promises to control in-flight operations
and fake clocks to test debounce, timeout, or deadline behavior. Polling an
observable condition may have a bounded failure timeout; it must finish as soon
as that condition holds.

Extend the existing owning workflow before adding another test or mount for the
same risk. Measure runtime before and after test-performance changes; fewer test
lines or cases alone do not demonstrate an improvement.

Run the component lab's scrolling regression with `npm run test:browser -w
@codex-app-sdk/component-lab`. Install its Chromium and WebKit runtimes once with
`npx playwright install chromium webkit` (add `--with-deps` on Linux CI).
The scrolling regression runs in both engines, including offscreen message
layout changes that can shift the reading position in iOS WebViews.

The streaming browser workflow also measures a 50 KB reply over 80 updates with
no history, a lazy 500-message history, all 501 messages mounted, and 50 settled
segments in the active turn. It checks that finished Markdown nodes and selection
survive, and only the active message updates, including the pane with host
header/mention slots. Run
`node samples/component-lab/tests/streaming.browser.mjs` from the repository root; use `--baseline=<git-ref> --measure-only` to compare an archived
revision without changing the checkout. Timing output is diagnostic; CI asserts
DOM and update isolation rather than a machine-dependent millisecond threshold.

## Put checks in the right tool

Tests must never read committed implementation or configuration files to assert
their text or source structure. This includes manifests, npm scripts, source
files, imports, CSS, and filenames. Test observable behavior instead; enforce
structural and security rules through executable compiler, lint, AST,
dependency, build, pack, or release validation. There is no source-text test
exception for architecture or security checks.

The only file-content exception is output created by the system under test. A
scaffolder may therefore assert the temporary `package.json` or source files it
generates.

## Completion

A test change is done when the claimed regression was red, the public boundary
is green, no existing scenario proves the same risk, coverage remains above its
current thresholds without filler, and the affected `check` command passes.
