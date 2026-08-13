# Task 12 report: Settings and Windows app lifecycle

## Status

Implemented Task 12 settings, tray, two-window lifecycle, capability boundaries, and monitor recovery on base `8b036b5`. The Manager uses the existing shortcut and backup command APIs; the overlay remains excluded from backup file selection and updater installation. Task 13 updater installation, signing, and packaging are intentionally not included.

## Delivered

- Bilingual Traditional Chinese/English Settings with immediate persisted language switching, overlay topmost preference, shortcut editing and conflict rollback, backup export/preview/replace confirmation, an update-settings placeholder, and runtime-derived About version.
- Warm Adventure Terminal sections and forms without dashboard cards, glass, gradients, pills, or hero styling.
- Native manager/overlay lifecycle with the specified default and minimum sizes, close-to-hide behavior, explicit tray Quit, retained tray state, second-instance Manager activation, tray actions, overlay-only topmost changes, and template shortcuts that always show/focus the overlay.
- Injectable monitor geometry and bounds clamping after monitor, work-area, or DPI changes.
- Exact compatible dialog `2.6.0`, single-instance `2.4.0`, and window-state `2.4.0` plugins; no fixed tray GUID before signing.
- Window-scoped topmost persistence excluded by the established backup boundary.
- Manager and overlay capability manifests plus command permissions. Overlay capabilities exclude dialog backup access and updater installation.
- Sanitized bilingual UI failures and focus-preserving confirmation flows.

## TDD evidence

Initial RED:

- `cargo test --manifest-path src-tauri/Cargo.toml windows`: failed because `services::windows` did not exist.
- Node 24.15 `npm test -- src/features/settings`: failed because the four required production settings modules did not exist; six pre-existing foundation tests remained green.

Final targeted GREEN:

- Node 24.15 `npm test -- src/features/settings`: 6 files / 14 tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml windows`: all 12 lifecycle, monitor, tray, topmost, capability, and shortcut-policy tests passed.

## Verification

- Node 24.15 `npm run verify`: pass; TypeScript, Biome, and 23 files / 134 tests.
- Node 24.15 `npm run build`: pass; Vite production build, 1,926 modules transformed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: pass.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`: pass.
- `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features`: pass; 78 Rust tests.
- Capability source assertions run within the 12-test Windows suite and passed.
- `git diff --check`: pass before commit.

## Formal review fixes and remaining concerns

Formal review found and this implementation corrected unstable default Settings API identities, backup export/import path coupling, a backup-visible topmost preference key, a hard-coded About version, and template shortcuts incorrectly toggling an already-visible overlay closed. The exact Cargo `windows` filter now executes all 12 Windows tests rather than filtering them out.

Automated tests cover lifecycle policy, capability manifests, and injected monitor geometry. A packaged Windows build was not manually exercised against a real system tray, global shortcuts, multi-monitor topology, or DPI transition in this task; signing, packaging, and updater installation remain Task 13 work.

## Formal review fix round 1: live recovery and overlay pin control

- Manager and overlay now reclamp at runtime on Tauri move, resize, and scale-factor events. The shared recovery controller applies DPI-scaled minimums, changes only differing bounds, guards reentrant recovery, and saves corrected size/position through the existing window-state plugin.
- Pure recovery tests cover monitor removal plus DPI change, repeated-event no-op behavior, already-visible bounds, and the original exact window defaults/minimums.
- The overlay header now exposes a compact localized pin/unpin `IconButton`, loads current native state, disables during initial load and persistence, reflects the confirmed native result, and presents sanitized failures without exposing native details.
- Manager Settings and overlay topmost controls prevent overlapping writes while a deferred request is pending, so an older result cannot overwrite a newer intent.
- Overlay capability access was expanded only with a dedicated permission for `get_window_settings` and `toggle_topmost`; backup, dialog, and updater installation remain excluded.

Strict TDD evidence:

- Runtime recovery RED: `windows_test` failed with unresolved `minimum_physical_size` and `recovery_adjustment` controller imports.
- Overlay/Manager RED: the overlay pin/unpin controls were absent and the Manager checkbox remained enabled during a deferred write.
- Targeted GREEN: 10 overlay/settings files / 36 tests; required Cargo `windows` filter 14/14; focused capability assertion 1/1.

Fresh full gates:

- Node 24.15 `npm run verify`: pass; 24 files / 137 tests.
- Node 24.15 `npm run build`: pass; 1,927 modules transformed.
- Cargo fmt check: pass.
- Strict Clippy, all targets/features with warnings denied: pass.
- Full Rust suite, all targets/features: pass; 80 tests.
- `git diff --check`: pass before commit.

The first full frontend gate stopped at Biome's deterministic import-order rule in `overlay-main.tsx`. After isolating that exact cause, imports were reordered and the complete fresh gate above passed. A real packaged-Windows monitor/DPI transition and tray/global-shortcut smoke test remains outside this automated review round.

## Formal review fix round 2: drag-safe recovery and synchronized topmost state

- Runtime moved/resized recovery now preserves ordinary drags whenever at least a usable 64x32 area remains visible on a current monitor and the window still fits a current work area. Cross-monitor straddling is left untouched. Off-screen or topology-invalid bounds still recover; scale-factor and startup recovery retain full clamping.
- Minimized, maximized, and fullscreen windows are excluded from recovery mutations.
- Recovery reads outer bounds but converts an oversized target to the correct inner physical size by subtracting the measured decoration delta. Pure regression coverage proves a decorated Manager converges in one resize and repeated events become no-ops.
- Native topmost reads and serialized mutations emit `window-settings-changed` with the camelCase `{ alwaysOnTop: boolean }` contract while holding the settings serialization boundary.
- Manager Settings and the overlay subscribe/unsubscribe to confirmed native changes. Load/event sequencing and mutation/event sequencing prevent stale reads or responses from overwriting newer cross-window state.
- The overlay pin uses an unknown/loading label with no false `aria-pressed` value until native state is confirmed.

Strict RED/GREEN evidence:

- RED Rust: missing recovery reason, presentation, and outer-to-inner conversion seams.
- RED React: missing loading semantics and cross-window subscriptions produced three focused failures.
- Targeted GREEN: 10 overlay/settings files / 41 tests; required Cargo `windows` filter 19/19.

Fresh full gates:

- Node 24.15 `npm run verify`: pass; 24 files / 142 tests.
- Node 24.15 `npm run build`: pass; 1,927 modules transformed.
- Cargo fmt check: pass.
- Strict Clippy, all targets/features with warnings denied: pass.
- Full Rust suite, all targets/features: pass; 85 tests.
- Capability assertions and `git diff --check`: pass before commit.

The first Rust GREEN rerun exposed one mechanical missing brace in the tightened visibility predicate; after correcting that exact parse failure, targeted and full gates passed fresh. Real packaged-Windows monitor removal, decorated resize, DPI transition, and cross-window WebView event smoke tests remain outside automated verification.

## Formal review fix round 3: subscription-first settings and DPI minimum convergence

- Extracted one shared `useWindowSettings` hook for Manager and overlay. It awaits listener registration before starting the serialized native read, immediately unregisters a listener that resolves after unmount, and generation-gates read success, read failure, mutation success, and mutation failure against newer native events.
- Listener registration rejection is handled as a sanitized retryable error rather than an unhandled promise. Failed initial reads retain unknown state; both controls stay disabled, while accessible bilingual retry actions restart subscription and read.
- The overlay pin no longer exposes a false label or `aria-pressed` state before native confirmation.
- Runtime recovery now returns an explicit plan containing optional position and optional inner size. It measures decoration deltas and includes them when deciding whether the configured scaled inner minimum can fit a work area.
- When the OS-enforced minimum inner size plus decorations cannot fit, recovery keeps that minimum, applies only a stable best-visible position, and avoids repeated impossible `set_size` and window-state save loops. Normal overlay resizing still converges through the decorated inner-size plan.

Strict RED/GREEN evidence:

- RED confirmed independent read-before-subscription UI effects and recovery's use of scaled inner minimums as outer dimensions.
- Targeted GREEN: shared hook/Manager/overlay 3 files / 13 tests; required Cargo Windows suite 21/21.
- Hook coverage includes events between registration and read, stale read resolve/reject, listener rejection, unmount before registration resolves, and initial-read retry.
- Geometry coverage includes decorated Manager at 150% on 720p and 200% on 1080p with simulated OS minimum enforcement, plus normal overlay convergence.

Fresh full gates:

- Node 24.15 `npm run verify`: pass; 25 files / 145 tests.
- Node 24.15 `npm run build`: pass; 1,928 modules transformed.
- Cargo fmt check: pass.
- Strict Clippy, all targets/features with warnings denied: pass.
- Full Rust suite, all targets/features: pass; 87 tests.
- Capability assertions and `git diff --check`: pass before commit.

Real packaged-Windows listener registration timing and high-DPI decorated-window behavior remain runtime smoke-test concerns.
