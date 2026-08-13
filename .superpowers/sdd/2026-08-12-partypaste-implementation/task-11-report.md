# Task 11 report: Manager library and variable UI

## Status

Implemented the production Manager against the existing Task 4-5 Tauri command client. The manager uses React Query, selected-game-scoped cache keys/invalidation, native mutation snapshots and Undo receipts, and no mock or parallel persistence model.

## Delivered

- Responsive manager shell with a 248px game/feature sidebar, phrase/group workspace, and inline inspector at 1000 CSS px and above.
- Accessible inspector drawer below 1000 CSS px, focus restoration, and dirty-edit confirmation on both form cancel and drawer Escape/close.
- Game/group/phrase create, edit, duplicate, favorite, delete, collapse, move, and reorder flows.
- Pointer and keyboard dnd-kit phrase sorting plus always-visible move up/down and move-to-group controls.
- Synthetic favorites manager view whose ordering calls `reorder_favorites` without changing group order; filtered reorder merges the visible order into the complete native sibling set.
- 250ms debounced native phrase search and favorite/template/shortcut filters.
- Native game/group delete-impact counts and destructive confirmation.
- Native Undo receipts displayed for their exact 10-second lifetime.
- Game-scoped variable definition and user-editable preset CRUD/order UI.
- Non-mutating variable rename-impact preview followed by explicit confirmed save.
- Existing Unicode/NFKC validation semantics and limits for manager fields and template syntax.
- Warm Adventure Terminal styling using existing tokens, fonts, restrained borders/radii, and no Task 12 settings/tray/window work.

## TDD evidence

Initial RED: all five new required UI suites failed because the production modules did not exist. Existing library API tests remained green.

Final targeted command:

`npm test -- src/features/library src/features/variables`

- 6 files passed
- 45 tests passed
- Includes axe checks and layout contracts at 760, 999, 1000, and 1440 CSS px

## Verification

- `npm run verify`: pass (typecheck, Biome, 19 files / 118 tests)
- `npm run build`: pass (Vite production build)
- `npm run test:ui`: blocked by the pre-existing Playwright discovery configuration. It scans `src/**/*.test.*` Vitest suites as Playwright tests, produces Vitest-suite context/import errors, and ends with `No tests found`. No Playwright spec/config exists in this checkout.
- Rust regression was not run because Task 11 changed no native contracts or Rust sources.
- `git diff --check`: pass before commit.

## Review notes and remaining concerns

The spec review found and this implementation corrected four concrete risks before final verification: favorite ordering was being re-sorted by group order, filtered phrase reorder did not send the complete sibling set, drawer Escape bypassed dirty confirmation, and a failed phrase save closed the draft.

One broader pre-existing/incremental concern remains: Task 11's newly introduced manager copy is English-first rather than fully routed through the bilingual catalog. Existing catalog entries cover only a subset of the new detailed commands and errors. This does not affect native data contracts or validated workflows, but the complete Manager translation pass should be addressed with the settings/language work rather than silently adding incomplete Traditional Chinese copy here.
