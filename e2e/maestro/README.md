# iOS UI regression harness (Maestro)

End-to-end UI tests that drive the app on the iOS Simulator — no manual tapping.
Maestro reads the accessibility tree, taps by `testID`, types, and screenshots.
This is how we verify UI-level regressions (e.g. the chat action menu, the edit
sheet, settings toggles) against the real running app, not just jest.

## Prerequisites

1. **Maestro** (`maestro` on PATH):
   ```sh
   curl -Ls "https://get.maestro.mobile.dev" | bash
   export PATH="$PATH:$HOME/.maestro/bin"
   ```
   Needs a JDK (11+). First run installs an XCUITest driver onto the sim (slow once).

2. **A booted iOS Simulator** running a debug build of the app, with **Metro
   serving this checkout**.

   > Metro gotcha for worktrees: Metro cannot bundle through a symlinked
   > `node_modules`. If this checkout's `node_modules` is a symlink, replace it
   > with a real APFS clone first:
   > ```sh
   > rm node_modules && cp -cR <primary>/node_modules ./node_modules
   > ```

## Run

```sh
./e2e/maestro/run.sh              # all flows on the booted sim
./e2e/maestro/run.sh flows/edit-message.yaml   # a single flow
```

The runner auto-detects the booted simulator UDID and passes `--device`.

## Flows

| Flow | Covers |
|---|---|
| `flows/smoke.yaml` | App launches, Home renders, a chat opens (navigation smoke) |
| `flows/edit-message.yaml` | Long-press a user message → action menu → Edit sheet opens |

### Known issue documented by these flows
Native text selection (tap-to-place-cursor, double-tap word select, dragging the
selection handles) does **not** work inside `AppSheet` because it is built on RN
`<Modal>`, which iOS hosts in a separate `UIWindow` that breaks `UITextInteraction`.
`flows/edit-message.yaml` drives the edit sheet open; a follow-up assertion on
working selection should be enabled once the AppSheet → in-root-overlay refactor
lands.

## Adding a flow
Target elements by `testID` (surfaces as `id:` in Maestro). Dump the current tree
to discover handles:
```sh
maestro --device <udid> hierarchy | less
```
