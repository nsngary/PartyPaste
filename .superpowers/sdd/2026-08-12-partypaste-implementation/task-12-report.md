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
