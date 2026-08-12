# PartyPaste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish PartyPaste, a polished local-first Windows 10/11 utility with an always-on-top phrase overlay, complete manager, editable game-scoped variable presets, safe backups, global shortcuts, and GitHub Releases packaging.

**Architecture:** A Tauri 2 host owns process lifecycle, two native windows, tray, shortcuts, clipboard, updater, and a transactional `rusqlite` repository. React 19 renders separate overlay and manager entry points against a typed command client; domain parsing and view state remain framework-independent and unit-testable. SQLite is the durable source of truth, while recent copies stay in a bounded Rust in-memory session store.

**Tech Stack:** Tauri 2.11.x, Rust 2024 edition, React 19.2.x, TypeScript 7.0.x, Vite 8.2.x, Vitest 4.1.x, Testing Library 16.x, Biome 2.5.x, Playwright 1.62.x, `rusqlite` 0.40.x, `rusqlite_migration` 2.6.x, React Query 5.101.x, i18next 26.x, dnd-kit 6/10.x.

## Global Constraints

- Support Windows 10 and Windows 11 only; exclusive fullscreen and game injection are explicitly unsupported.
- Copy Unicode plain text only. Never simulate paste, Enter, keyboard chat submission, or game input.
- Ship Traditional Chinese and English UI; accept arbitrary Unicode phrase content.
- Keep all user-authored content local. No accounts, telemetry, analytics, ads, or remote phrase storage.
- The only routine network operation is a GitHub Releases update check, at most once per 24 hours unless manually requested.
- Installed mode stores data in the application data directory; portable mode is selected by a `partypaste.portable` marker beside the executable and stores data in `data/` beside it.
- Overlay defaults to `300x420`, minimum `240x160`; manager defaults to `1120x720`, minimum `760x560`.
- Bundle Press Start 2P only for short English labels, Noto Sans TC for UI text, and IBM Plex Mono for shortcut/token labels. Include all font notices.
- Backup restore validates first, creates an automatic backup, then uses complete replacement in one transaction. It never merges.
- Recent copies are memory-only, successful-copy-only, capped at 30, and cleared at process exit.
- Beta artifacts may be unsigned by Windows Authenticode but must carry SHA-256 and Tauri update signatures. Stable 1.0 requires Authenticode.
- Use MIT License. Do not commit signing keys, update private keys, user databases, local backups, or release credentials.
- Every behavior change follows red-green-refactor; every task ends with targeted tests and a scoped commit.

## File and module map

### Root and build

- `package.json`, `package-lock.json`: exact frontend/tooling dependency lock and scripts.
- `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `biome.json`: build, test, type, and format boundaries.
- `index.html`, `overlay.html`: manager and overlay Vite entry documents.
- `playwright.config.ts`: packaged-web UI smoke and visual test configuration.
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`: verification and artifact publication.
- `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`: public project documentation.

### React application

- `src/app/manager-main.tsx`, `src/app/overlay-main.tsx`: entry points only.
- `src/app/providers.tsx`: query and localization providers.
- `src/api/contracts.ts`: shared serialized DTOs and command error discriminants.
- `src/api/commands.ts`: the only frontend wrapper around Tauri `invoke`.
- `src/domain/template.ts`: pure template scanner, escaping, and preview resolver.
- `src/domain/validation.ts`: UI-side length and form validation matching Rust.
- `src/domain/ordering.ts`: pure reorder helpers.
- `src/i18n/index.ts`, `src/i18n/locales/{zh-TW,en}.json`: localization.
- `src/components/*`: reusable primitives with no repository knowledge.
- `src/features/overlay/*`: compact list, favorites, template form, feedback, and recent history.
- `src/features/library/*`: games, groups, phrases, search, filters, inspector, Undo, and ordering.
- `src/features/variables/*`: variable definitions and preset editor.
- `src/features/settings/*`: language, shortcuts, updates, and application preferences.
- `src/styles/*`: tokens, fonts, reset, shared controls, manager, and overlay styles.

### Tauri/Rust application

- `src-tauri/src/lib.rs`, `main.rs`: builder and executable entry only.
- `src-tauri/src/error.rs`: stable `AppError` to `CommandErrorDto` mapping.
- `src-tauri/src/paths.rs`: installed/portable path resolution.
- `src-tauri/src/db/{mod.rs,migrations.rs,models.rs,repository.rs}`: connection, schema, records, and transactional CRUD.
- `src-tauri/src/services/{library.rs,templates.rs,clipboard.rs,shortcuts.rs,backup.rs,session.rs,windows.rs,updates.rs}`: bounded application services.
- `src-tauri/src/commands/{mod.rs,library.rs,clipboard.rs,backup.rs,settings.rs,updates.rs}`: thin typed Tauri command adapters.
- `src-tauri/migrations/*.sql`: forward SQLite migrations.
- `src-tauri/capabilities/{manager.json,overlay.json}`: least-privilege window capabilities.
- `src-tauri/tauri.conf.json`: windows, bundling, updater, CSP, and installer settings.

---

### Task 1: Reproducible Tauri/React foundation

**Files:**
- Create: `package.json`, `package-lock.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `biome.json`
- Create: `index.html`, `overlay.html`, `src/app/manager-main.tsx`, `src/app/overlay-main.tsx`, `src/test/setup.ts`, `src/app/entrypoints.test.ts`
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/icons/*`
- Modify: `.gitignore`

**Interfaces:**
- Produces: two Vite entries `manager-main.tsx` and `overlay-main.tsx`; npm scripts `dev`, `build`, `typecheck`, `lint`, `format`, `test`, `test:ui`, `tauri`, and `verify`.

- [ ] **Step 1: Add the failing entrypoint test**

```ts
// src/app/entrypoints.test.ts
import { describe, expect, it } from "vitest";
import { routeForWindowLabel } from "./window-route";

describe("routeForWindowLabel", () => {
  it.each([["manager", "/"], ["overlay", "/overlay.html"]])("maps %s", (label, route) => {
    expect(routeForWindowLabel(label)).toBe(route);
  });
});
```

- [ ] **Step 2: Install the exact dependencies and verify the test fails**

Run `npm install --save-exact react@19.2.8 react-dom@19.2.8 @tauri-apps/api@2.11.1 @tanstack/react-query@5.101.4 i18next@26.3.6 react-i18next@17.0.11 @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 lucide-react@1.31.0 @fontsource/press-start-2p@5.3.0 @fontsource-variable/noto-sans-tc@5.3.0 @fontsource/ibm-plex-mono@5.3.0`, then `npm install --save-dev --save-exact @tauri-apps/cli@2.11.4 typescript@7.0.2 vite@8.2.1 @vitejs/plugin-react@6.0.5 vitest@4.1.10 jsdom@30.0.1 @testing-library/react@16.3.2 @testing-library/user-event@14.6.4 @biomejs/biome@2.5.8 axe-core@4.13.0 playwright@1.62.1 @types/react@19.2.18 @types/react-dom@19.2.4 @types/node@26.2.0`, then run `npm test -- src/app/entrypoints.test.ts`.

Expected: FAIL because `src/app/window-route.ts` does not exist.

- [ ] **Step 3: Scaffold the minimal dual-entry app and Tauri host**

Create `routeForWindowLabel(label: "manager" | "overlay"): "/" | "/overlay.html"`, render a semantic `<main>` landmark headed `PartyPaste Manager` or `PartyPaste Overlay` from each entry, configure Vite multi-page input, and configure Tauri windows with the exact sizes in Global Constraints. Pin Rust crates to compatible minor versions: `tauri 2.11`, `serde 1`, `serde_json 1`, and `thiserror 2`.

- [ ] **Step 4: Verify the foundation**

Run `npm run verify`, `npm run build`, `cargo fmt --check --manifest-path src-tauri/Cargo.toml`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, and `cargo test --manifest-path src-tauri/Cargo.toml`.

Expected: all commands exit 0 and Vite emits both HTML entries.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json vite.config.ts vitest.config.ts tsconfig*.json biome.json index.html overlay.html src src-tauri .gitignore
git commit -m "chore: scaffold PartyPaste desktop app"
```

### Task 2: Shared contracts, errors, and installed/portable paths

**Files:**
- Create: `src/api/contracts.ts`, `src/api/commands.ts`, `src/api/commands.test.ts`
- Create: `src-tauri/src/error.rs`, `src-tauri/src/paths.rs`, `src-tauri/tests/paths_test.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `CommandErrorDto { code, messageKey, details? }`, `invokeCommand<TInput,TOutput>(name,input): Promise<TOutput>`, and Rust `DataPaths { database, backups, logs, portable }`.

- [ ] **Step 1: Write failing TypeScript and Rust contract tests**

Test that a rejected Tauri invoke payload `{ code: "shortcut_conflict", messageKey: "errors.shortcutConflict" }` becomes `CommandError`, and that `resolve_data_paths(exe, app_data, marker_exists)` selects `exe/data` only when the portable marker exists.

- [ ] **Step 2: Run tests and confirm missing symbols**

Run `npm test -- src/api/commands.test.ts` and `cargo test --manifest-path src-tauri/Cargo.toml paths_test`.

Expected: FAIL for undefined command wrapper and path resolver.

- [ ] **Step 3: Implement the minimal typed boundary**

Use discriminated error codes `validation`, `not_found`, `shortcut_conflict`, `clipboard_busy`, `backup_invalid`, `database`, `update`, and `internal`. Ensure `AppError` serialization never includes user phrase text. Add unit-test dependency injection to `invokeCommand` instead of mocking global Tauri modules.

- [ ] **Step 4: Verify targeted and full tests**

Run both targeted commands, then `npm run verify` and `cargo test --manifest-path src-tauri/Cargo.toml`.

- [ ] **Step 5: Commit**

```powershell
git add src/api src-tauri/src/error.rs src-tauri/src/paths.rs src-tauri/tests src-tauri/src/lib.rs
git commit -m "feat: add native command contracts and data paths"
```

### Task 3: SQLite schema, migrations, and transactional repository

**Files:**
- Create: `src-tauri/migrations/0001_initial.sql`
- Create: `src-tauri/src/db/mod.rs`, `migrations.rs`, `models.rs`, `repository.rs`
- Create: `src-tauri/tests/repository_test.rs`, `src-tauri/tests/migration_test.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `Repository::open(DataPaths)`, `Repository::in_memory()`, `Repository::snapshot() -> LibrarySnapshot`, and `Repository::transaction(|LibraryTx| ...)`.
- Produces record types `GameRecord`, `GroupRecord`, `PhraseRecord`, `VariableDefinitionRecord`, `VariablePresetRecord`, `PhraseVariableRefRecord`, and `SettingRecord`.

- [ ] **Step 1: Write failing schema and rollback tests**

Cover foreign keys enabled, all tables and unique indexes created, ordered siblings reindexed, deleting a parent requiring explicit service action, and a failed multi-record operation leaving the pre-transaction snapshot unchanged.

- [ ] **Step 2: Verify migration tests fail**

Run `cargo test --manifest-path src-tauri/Cargo.toml --test migration_test --test repository_test`.

Expected: FAIL because the database modules and migration are absent.

- [ ] **Step 3: Implement the initial schema and repository primitives**

Use `rusqlite = { version = "0.40", features = ["bundled"] }`, `rusqlite_migration = "2.6"`, UUID text primary keys, integer sort orders, `PRAGMA foreign_keys=ON`, and unique `(game_id, normalized_name)` for variables. Keep SQL confined to `db/`.

- [ ] **Step 4: Run database verification**

Run the targeted tests twice: once normally and once with `RUST_BACKTRACE=1`. Then run Clippy and all Rust tests.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/migrations src-tauri/src/db src-tauri/src/lib.rs src-tauri/tests
git commit -m "feat: add transactional PartyPaste database"
```

### Task 4: Template parser and game-scoped variable library

**Files:**
- Create: `src/domain/template.ts`, `src/domain/template.test.ts`
- Create: `src-tauri/src/services/templates.rs`, `src-tauri/tests/templates_test.rs`
- Create: `src-tauri/src/services/library.rs`, `src-tauri/src/commands/library.rs`
- Modify: `src-tauri/src/services/mod.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: TS `parseTemplate(source): TemplateParseResult` and `resolveTemplate(tokens, values): Result<string, TemplateIssue[]>`.
- Produces: Rust `TemplateService::scan`, `VariableService::rename_definition`, and commands `list_variable_definitions`, `save_variable_definition`, `reorder_variable_presets`, `delete_variable_definition`.

- [ ] **Step 1: Write the shared behavior fixtures and failing tests**

Create fixtures for `{人數}`, escaped `{{`/`}}`, repeated variables, unbalanced braces, empty names, control characters, unknown variables, rename impact counts, atomic rename, and delete-to-free-text fallback. Both TS and Rust tests must consume equivalent fixture cases.

- [ ] **Step 2: Run both suites and confirm failure**

Run `npm test -- src/domain/template.test.ts` and `cargo test --manifest-path src-tauri/Cargo.toml templates`.

- [ ] **Step 3: Implement scanner, resolver, and transactional variable operations**

Represent scanned tokens as `TextToken | VariableToken`; do not use regular-expression replacement as the source of truth. On rename, update definition, phrase token text, and `phrase_variable_refs` in one transaction. On deletion, remove definition/presets/refs but keep braces in phrase bodies as unknown free-text fields.

- [ ] **Step 4: Verify parity and repository state**

Run targeted TS/Rust tests and `cargo test --manifest-path src-tauri/Cargo.toml --test repository_test`.

- [ ] **Step 5: Commit**

```powershell
git add src/domain src-tauri/src/services src-tauri/src/commands src-tauri/src/lib.rs src-tauri/tests
git commit -m "feat: add phrase templates and variable presets"
```

### Task 5: Complete library CRUD, ordering, favorites, search, and Undo

**Files:**
- Create: `src/domain/ordering.ts`, `src/domain/ordering.test.ts`, `src/domain/validation.ts`, `src/domain/validation.test.ts`
- Create: `src/features/library/library-api.ts`, `src/features/library/library-api.test.ts`
- Modify: `src-tauri/src/services/library.rs`, `src-tauri/src/commands/library.rs`, `src-tauri/tests/repository_test.rs`

**Interfaces:**
- Produces commands `get_library`, `create/update/delete_game`, `create/update/delete_group`, `create/update/delete/duplicate_phrase`, `move_phrase`, `reorder_*`, `set_favorite`, `search_phrases`, and `undo_operation`.
- Produces `UndoReceipt { operationId, expiresAt }` with a 10-second validity window.

- [ ] **Step 1: Add failing domain and command tests**

Cover exact length limits from the spec, Unicode normalization, group and favorite order independence, move-to-group reindexing, search over title/body/hotkey, 10-second Undo success, expired Undo rejection, and destructive child counts.

- [ ] **Step 2: Run tests to prove red state**

Run `npm test -- src/domain src/features/library/library-api.test.ts` and `cargo test --manifest-path src-tauri/Cargo.toml library`.

- [ ] **Step 3: Implement minimal CRUD and operation journal**

Keep an in-memory bounded Undo journal containing inverse operations, not an unbounded database history. Persist only confirmed library state. Return new snapshots or affected DTOs so React Query can update predictably.

- [ ] **Step 4: Verify ordering invariants**

Run targeted suites plus a test that performs 100 mixed moves and asserts sibling sort positions remain unique, contiguous, and zero-based.

- [ ] **Step 5: Commit**

```powershell
git add src/domain src/features/library src-tauri/src/services/library.rs src-tauri/src/commands/library.rs src-tauri/tests
git commit -m "feat: add phrase library operations"
```

### Task 6: Clipboard copying and memory-only recent history

**Files:**
- Create: `src-tauri/src/services/clipboard.rs`, `session.rs`
- Create: `src-tauri/src/commands/clipboard.rs`, `src-tauri/tests/clipboard_test.rs`
- Create: `src/features/overlay/copy-api.ts`, `copy-api.test.ts`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces commands `copy_phrase({ phraseId, variables }) -> CopySuccessDto` and `get_recent_copies() -> RecentCopyDto[]`.
- `ClipboardPort::write_text(&str) -> Result<(), ClipboardError>` permits deterministic retry tests.

- [ ] **Step 1: Write failing copy-service tests**

Cover plain Unicode copy, resolved template copy, missing variables, two transient clipboard failures followed by success, final failure mapped to `clipboard_busy`, only successful copies entering history, cap 30, newest-first order, and empty history in a new process store.

- [ ] **Step 2: Run tests and confirm red state**

Run `cargo test --manifest-path src-tauri/Cargo.toml clipboard` and `npm test -- src/features/overlay/copy-api.test.ts`.

- [ ] **Step 3: Implement the port, bounded retry, and session store**

Use `tauri-plugin-clipboard-manager 2.3`; retries are 3 total attempts with short native delays no greater than 50 ms and 100 ms. Store only phrase ID, title, resolved-at timestamp, and resolved text required for the session history view; never log any of them.

- [ ] **Step 4: Verify no persistence leak**

Run the targeted tests and assert repository snapshots and exported backup DTOs contain no recent-copy records.

- [ ] **Step 5: Commit**

```powershell
git add src/features/overlay src-tauri/Cargo.toml src-tauri/src/services src-tauri/src/commands src-tauri/src/lib.rs src-tauri/tests
git commit -m "feat: add safe clipboard copying and recent history"
```

### Task 7: Global shortcut registry and conflict recovery

**Files:**
- Create: `src-tauri/src/services/shortcuts.rs`, `src-tauri/src/commands/settings.rs`, `src-tauri/tests/shortcuts_test.rs`
- Create: `src/features/settings/shortcut-model.ts`, `shortcut-model.test.ts`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src/api/contracts.ts`

**Interfaces:**
- Produces `ShortcutPort`, `ShortcutRegistry::replace(action,new)`, `ShortcutRegistry::rebuild(snapshot)`, and commands `get_shortcuts`, `set_overlay_shortcut`, `set_phrase_shortcut`.

- [ ] **Step 1: Write failing shortcut tests**

Cover required modifier, normalized duplicates, OS registration rejection, preservation and re-registration of the previous working shortcut, partial rebuild success, plain phrase immediate-copy action, and template action showing the overlay with `openTemplatePhraseId`.

- [ ] **Step 2: Verify failures**

Run `cargo test --manifest-path src-tauri/Cargo.toml shortcuts` and `npm test -- src/features/settings/shortcut-model.test.ts`.

- [ ] **Step 3: Implement registry against an injectable port**

Use `tauri-plugin-global-shortcut 2.3`. Persist a new accelerator only after successful registration. On replacement, unregister old, try new, and re-register old if new fails. Never let one imported conflict prevent unrelated shortcuts.

- [ ] **Step 4: Verify lifecycle cleanup**

Add and run a test confirming all registrations are released on application shutdown and rebuilt once on startup/import.

- [ ] **Step 5: Commit**

```powershell
git add src/features/settings src/api/contracts.ts src-tauri/Cargo.toml src-tauri/src/services/shortcuts.rs src-tauri/src/commands/settings.rs src-tauri/src/lib.rs src-tauri/tests
git commit -m "feat: add configurable global shortcuts"
```

### Task 8: Safe JSON export, replacement restore, and migration backups

**Files:**
- Create: `src-tauri/src/services/backup.rs`, `src-tauri/src/commands/backup.rs`, `src-tauri/tests/backup_test.rs`
- Create: `src/features/settings/backup-api.ts`, `backup-api.test.ts`
- Modify: `src/api/contracts.ts`, `src-tauri/src/db/migrations.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces `BackupDocumentV1`, `ImportPreviewDto`, commands `export_backup(path)`, `preview_import(path)`, and `replace_from_backup(path, previewToken)`.

- [ ] **Step 1: Write failing import/export tests**

Cover stable UTF-8 round trip, `schemaVersion: 1`, excluded recent/window/machine data, 10 MiB rejection, malformed JSON, unsupported version, duplicate IDs/names, preview counts, automatic pre-import backup, transaction rollback, five-backup retention, and shortcut conflict summary.

- [ ] **Step 2: Run tests to confirm failure**

Run `cargo test --manifest-path src-tauri/Cargo.toml backup` and `npm test -- src/features/settings/backup-api.test.ts`.

- [ ] **Step 3: Implement validate-first import**

Read metadata and bounded bytes, deserialize to a versioned enum, validate all referential and ordering invariants, hash the validated document into a short-lived preview token, create an atomic timestamped safety copy, then replace within one SQLite transaction only when the token still matches.

- [ ] **Step 4: Verify failure leaves identical snapshot**

Run a parameterized test for every failure boundary and byte-compare the active library snapshot before and after.

- [ ] **Step 5: Commit**

```powershell
git add src/features/settings src/api/contracts.ts src-tauri/src/services/backup.rs src-tauri/src/commands/backup.rs src-tauri/src/db/migrations.rs src-tauri/src/lib.rs src-tauri/tests
git commit -m "feat: add safe library backup and restore"
```

### Task 9: Localization, font assets, design tokens, and accessible primitives

**Files:**
- Create: `src/i18n/index.ts`, `src/i18n/i18n.test.ts`, `src/i18n/locales/zh-TW.json`, `en.json`
- Create: `src/styles/fonts.css`, `tokens.css`, `reset.css`, `controls.css`
- Create: `src/components/Button.tsx`, `IconButton.tsx`, `Dialog.tsx`, `Drawer.tsx`, `ToastRegion.tsx`, `SegmentedControl.tsx`, `Field.tsx`
- Create: `src/components/components.test.tsx`
- Create: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Produces `AppProviders`, semantic design tokens, and keyboard-accessible primitive components used by all later UI tasks.

- [ ] **Step 1: Write failing catalog and accessibility tests**

Assert zh-TW/en key equality, English fallback, locale switching, button accessible names, dialog focus trap and Escape close, toast live-region behavior, and segmented-control keyboard selection.

- [ ] **Step 2: Run component tests and verify red state**

Run `npm test -- src/i18n src/components`.

- [ ] **Step 3: Implement providers, bundled fonts, and primitives**

Use CSS variables for approved ink green, amber, warm white, sage, spacing, radius, and focus ring. Honor `prefers-reduced-motion`. Import only required font weights. Document OFL licenses in third-party notices.

- [ ] **Step 4: Run automated accessibility checks**

Run targeted tests, `npm run typecheck`, `npm run lint`, and component axe checks with zero serious or critical violations.

- [ ] **Step 5: Commit**

```powershell
git add src/i18n src/styles src/components THIRD_PARTY_NOTICES.md
git commit -m "feat: add localized PartyPaste design system"
```

### Task 10: Gameplay overlay UI

**Files:**
- Create: `src/features/overlay/OverlayApp.tsx`, `OverlayHeader.tsx`, `PhraseList.tsx`, `PhraseRow.tsx`, `TemplateForm.tsx`, `RecentCopies.tsx`, `CopyFeedback.tsx`
- Create: `src/features/overlay/OverlayApp.test.tsx`, `TemplateForm.test.tsx`
- Create: `src/styles/overlay.css`
- Modify: `src/app/overlay-main.tsx`, `src/app/providers.tsx`

**Interfaces:**
- Consumes: library/copy commands, parsed template tokens, common presets, and `openTemplatePhraseId` shortcut event.
- Produces: title/full modes, game selection, favorites synthetic group, inline template form, recent view, and copy feedback.

- [ ] **Step 1: Write failing user-flow tests**

Cover title/full rendering, per-game mode persistence, collapsed groups, favorites without duplication, successful plain copy toast, failed-copy retry action, common-preset selection, custom input, disabled incomplete copy, live preview, Escape collapse, and shortcut-opened template focus.

- [ ] **Step 2: Run overlay tests and confirm red state**

Run `npm test -- src/features/overlay`.

- [ ] **Step 3: Implement the approved vertical compact layout**

Keep row hit targets at least 32 logical pixels, allow natural height in full mode, virtualize only if measured performance with 500 phrases requires it, and use no hover-only controls. Persist only overlay preferences, not temporary variable values.

- [ ] **Step 4: Verify compact and keyboard behavior**

Run tests at 240, 300, and 420 CSS-pixel widths; verify Tab, Enter, Space, arrows where applicable, and Escape. Run axe checks.

- [ ] **Step 5: Commit**

```powershell
git add src/features/overlay src/styles/overlay.css src/app/overlay-main.tsx src/app/providers.tsx
git commit -m "feat: build compact phrase overlay"
```

### Task 11: Manager library and variable UI

**Files:**
- Create: `src/features/library/ManagerApp.tsx`, `GameSidebar.tsx`, `PhraseToolbar.tsx`, `GroupSection.tsx`, `PhraseCard.tsx`, `PhraseInspector.tsx`, `DeleteConfirm.tsx`, `UndoToast.tsx`
- Create: `src/features/variables/VariableLibrary.tsx`, `VariableDefinitionCard.tsx`, `PresetEditor.tsx`
- Create: `src/features/library/ManagerApp.test.tsx`, `PhraseInspector.test.tsx`, `GroupSection.test.tsx`, `src/features/variables/VariableLibrary.test.tsx`, `PresetEditor.test.tsx`
- Create: `src/styles/manager.css`
- Modify: `src/app/manager-main.tsx`, `src/app/providers.tsx`

**Interfaces:**
- Consumes: all library and variable commands from Tasks 4-5.
- Produces: approved three-column manager, sub-1000 drawer, CRUD forms, search/filters, DnD plus move menu, destructive counts, and Undo.

- [ ] **Step 1: Write failing manager workflow tests**

Cover create/edit/duplicate/delete game/group/phrase, debounced search, favorite/template/shortcut filters, inspector dirty-state cancellation, destructive child count, Undo, drag reorder, keyboard move alternatives, variable CRUD, preset ordering, rename impact confirmation, and responsive drawer.

- [ ] **Step 2: Run tests and confirm missing UI**

Run `npm test -- src/features/library src/features/variables`.

- [ ] **Step 3: Implement manager using React Query and dnd-kit**

Use query invalidation scoped to the selected game. Use dnd-kit only for pointer/keyboard drag; keep explicit move menu commands. Preserve focus after mutations and return focus to the triggering control after dialogs/drawers close.

- [ ] **Step 4: Verify responsive and accessible layouts**

Test widths 760, 999, 1000, and 1440; run axe, typecheck, lint, and UI tests.

- [ ] **Step 5: Commit**

```powershell
git add src/features/library src/features/variables src/styles/manager.css src/app/manager-main.tsx src/app/providers.tsx
git commit -m "feat: build phrase manager and variable library"
```

### Task 12: Settings, tray, two-window lifecycle, and monitor recovery

**Files:**
- Create: `src/features/settings/SettingsPage.tsx`, `ShortcutSettings.tsx`, `UpdateSettings.tsx`, `BackupSettings.tsx`, `AboutPage.tsx`
- Create: `src/features/settings/SettingsPage.test.tsx`, `ShortcutSettings.test.tsx`, `UpdateSettings.test.tsx`, `BackupSettings.test.tsx`
- Create: `src-tauri/src/services/windows.rs`, `src-tauri/tests/windows_test.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/*.json`

**Interfaces:**
- Produces native actions `show_overlay`, `hide_overlay`, `open_manager`, `toggle_topmost`, `quit_app`, bounds clamping, tray menu, and single-instance activation.

- [ ] **Step 1: Write failing lifecycle and settings tests**

Cover close-to-hide, explicit Quit, second-instance focus, tray actions, overlay preference save, bounds clamping after monitor removal, manager normal window behavior, topmost toggle, language change, shortcut conflict UI, and import/export UI confirmations.

- [ ] **Step 2: Run Rust and React tests for red state**

Run `cargo test --manifest-path src-tauri/Cargo.toml windows` and `npm test -- src/features/settings`.

- [ ] **Step 3: Implement native lifecycle with injectable monitor geometry**

Use `tauri-plugin-single-instance 2.4` and `tauri-plugin-window-state 2.4` only where their persisted state can be clamped. Construct the tray after app readiness, keep it alive in state, and use a fixed tray GUID only after Authenticode signing is configured.

- [ ] **Step 4: Verify capability boundaries**

Assert overlay capabilities exclude backup file selection and updater installation; manager capabilities expose only required commands. Run `npm run verify`, Clippy, and Rust tests.

- [ ] **Step 5: Commit**

```powershell
git add src/features/settings src-tauri/src/services/windows.rs src-tauri/tests/windows_test.rs src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/capabilities
git commit -m "feat: add settings and Windows app lifecycle"
```

### Task 13: Signed updater and installed/portable packaging

**Files:**
- Create: `src-tauri/src/services/updates.rs`, `src-tauri/src/commands/updates.rs`, `src-tauri/tests/updates_test.rs`
- Create: `scripts/package-portable.ps1`, `scripts/hashes.ps1`, `scripts/verify-artifacts.ps1`
- Modify: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src/features/settings/UpdateSettings.tsx`, `.gitignore`

**Interfaces:**
- Produces `check_for_update(manual) -> UpdateCheckDto`, installed-mode approved updater flow, portable-mode GitHub Release opener, and deterministic artifact scripts.

- [ ] **Step 1: Write failing updater-policy tests**

Cover 24-hour throttle, manual bypass, quiet automatic offline failure, visible manual failure, installed vs portable action, required update signature metadata, and no automatic download before user approval.

- [ ] **Step 2: Run tests and confirm red state**

Run `cargo test --manifest-path src-tauri/Cargo.toml updates` and the UpdateSettings component tests.

- [ ] **Step 3: Implement updater and packaging scripts**

Use `tauri-plugin-updater 2.10`. Generate the updater key at `work/release-secrets/partypaste-updater.key`, which is already ignored, using `npm run tauri signer generate -- -w work/release-secrets/partypaste-updater.key`; commit only its public key in Tauri configuration, require the private key and password as release secrets, and stop release execution if the user has not copied the private key to durable secure storage. Portable packaging adds `partypaste.portable`, notices, and empty `data/`, never updater self-replacement.

- [ ] **Step 4: Build and inspect local beta artifacts**

Run `npm run tauri build`, `powershell -File scripts/package-portable.ps1`, `powershell -File scripts/hashes.ps1`, and `powershell -File scripts/verify-artifacts.ps1`.

Expected: NSIS installer, portable ZIP, updater artifact/signature, and SHA-256 manifest are present; unsigned local beta is labeled as such.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri src/features/settings scripts .gitignore
git commit -m "feat: add signed updates and Windows packaging"
```

### Task 14: End-to-end UI, DPI, and Windows acceptance harness

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/manager.spec.ts`, `overlay.spec.ts`, `backup.spec.ts`, `accessibility.spec.ts`
- Create: `tests/fixtures/library-v1.json`
- Create: `docs/testing/windows-acceptance.md`, `docs/testing/release-candidate-template.md`
- Modify: `package.json`

**Interfaces:**
- Produces repeatable browser-level smoke coverage and a manual Windows checklist for native-only behavior.

- [ ] **Step 1: Write failing E2E tests against production entries**

Use an injected fake command bridge to exercise create/edit/reorder/copy/template/backup/settings flows. Add screenshots for overlay widths and manager breakpoints in zh-TW/en at device scales representing 100%, 150%, and 200%.

- [ ] **Step 2: Run E2E tests and confirm baseline failures**

Run `npm run build` then `npm run test:e2e`.

- [ ] **Step 3: Fix only exposed integration seams and write native acceptance steps**

The manual checklist must record OS build, DPI, monitor layout, artifact hashes, system tray, single instance, window recovery, configurable shortcuts/conflicts, clipboard in ordinary fields and representative borderless/windowed games, NSIS install/upgrade/uninstall data preservation, portable behavior, offline updater, and exclusive-fullscreen documentation.

- [ ] **Step 4: Run the complete automated matrix**

Run `npm run verify`, `npm run build`, `npm run test:e2e`, `cargo fmt --check --manifest-path src-tauri/Cargo.toml`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, and `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`.

- [ ] **Step 5: Commit**

```powershell
git add playwright.config.ts tests docs/testing package.json package-lock.json src
git commit -m "test: add PartyPaste release acceptance coverage"
```

### Task 15: Public documentation, license, security, and contribution guide

**Files:**
- Create: `README.md`, `README.zh-TW.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`
- Create: `docs/user-guide/zh-TW.md`, `docs/user-guide/en.md`, `docs/releasing.md`
- Modify: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Produces complete GitHub onboarding, usage, limitations, privacy, build, test, release, and responsible-disclosure documentation.

- [ ] **Step 1: Add failing documentation checks**

Create a script or Vitest check that requires both languages to document Windows support, borderless recommendation, no injection/automation, local storage, backup replacement, portable data deletion risk, beta SmartScreen warning, MIT, and artifact verification commands.

- [ ] **Step 2: Run the docs check and confirm failure**

Run `npm test -- tests/docs`.

- [ ] **Step 3: Write the public documentation and MIT license**

Include exact source-build prerequisites (Node, npm, Rust, Windows C++ build tools, WebView2), complete commands, screenshots added only from a verified release candidate, privacy statement, updater behavior, JSON restore warning, data paths, troubleshooting, and vulnerability reporting that avoids public disclosure of unpatched issues.

- [ ] **Step 4: Verify links, required statements, and clean tree**

Run docs tests, `npm run verify`, `git diff --check`, and inspect `git status --short` for unexpected binaries or user data.

- [ ] **Step 5: Commit**

```powershell
git add README.md README.zh-TW.md LICENSE SECURITY.md CONTRIBUTING.md CHANGELOG.md docs THIRD_PARTY_NOTICES.md tests/docs
git commit -m "docs: prepare PartyPaste for open source release"
```

### Task 16: GitHub CI, release workflow, and beta release candidate

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/ISSUE_TEMPLATE/bug.yml`, `feature.yml`, `.github/pull_request_template.md`
- Modify: `docs/releasing.md`, `CHANGELOG.md`

**Interfaces:**
- Produces required Windows CI and tag-driven draft GitHub Release with installer, portable ZIP, updater files/signatures, hashes, and provenance-aware logs.

- [ ] **Step 1: Write workflow policy assertions**

Add a local test that parses workflow YAML and asserts pinned major actions, least-privilege permissions, npm cache, Rust cache, all verification gates, secret presence checks for release signing, artifact verification before upload, and a draft Release default.

- [ ] **Step 2: Run workflow tests and confirm failure**

Run `npm test -- tests/workflows`.

- [ ] **Step 3: Implement CI and release workflows**

CI runs on Windows for pull requests and main. Release runs only for version tags, builds from the lockfile, signs Tauri update artifacts, optionally applies Authenticode when configured, verifies artifact contents/hashes, and uploads to a draft release. Never echo secrets or upload databases/logs.

- [ ] **Step 4: Execute the release-candidate gate**

Run the full Task 14 matrix, build candidate artifacts, complete `docs/testing/release-candidate-template.md` on clean Windows 10 and 11 environments, verify all SHA-256 values, and confirm the tag version matches npm, Cargo, Tauri config, and changelog.

- [ ] **Step 5: Commit and stop before external publication**

```powershell
git add .github docs/releasing.md CHANGELOG.md tests/workflows
git commit -m "ci: add PartyPaste verification and release workflows"
```

Do not create a GitHub repository, push, tag, buy a certificate, configure secrets, or publish a Release without explicit user authorization at execution time.

## Final implementation verification

- [ ] Map every acceptance criterion in `docs/superpowers/specs/2026-08-12-partypaste-design.md` to a passing automated test or a signed Windows acceptance checklist entry.
- [ ] Run `npm ci` in a clean checkout followed by `npm run verify`, `npm run build`, and `npm run test:e2e`.
- [ ] Install the pinned Rust toolchain in the clean checkout and run format, Clippy with warnings denied, and all tests.
- [ ] Build and verify NSIS, portable ZIP, updater signatures, and SHA-256 manifest from the clean checkout.
- [ ] Confirm no user phrases, databases, backups, logs, signing keys, or credentials are tracked by `git ls-files`.
- [ ] Confirm the beta limitation notice is present if Authenticode is not configured; block stable 1.0 otherwise.
- [ ] Request a final code review before any push, tag, or GitHub Release publication.
