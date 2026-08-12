# PartyPaste Design Specification

Date: 2026-08-12

Status: Approved design

Target release: Windows beta, followed by signed 1.0

License: MIT

## 1. Product summary

PartyPaste is a local-first Windows desktop utility for copying reusable phrases while playing games. It provides a compact always-on-top window for one-click copying and a separate management window for organizing content. It never injects into games, simulates keystrokes, or sends chat messages.

The first release supports Windows 10 and Windows 11. The overlay is supported over windowed and borderless-windowed games. Exclusive fullscreen games are explicitly out of scope; users are directed to borderless-windowed mode.

The application interface ships in Traditional Chinese and English. Phrase content accepts arbitrary Unicode text.

## 2. Goals

- Copy a saved phrase to the Windows clipboard with one click.
- Keep the gameplay window compact, readable, resizable, and optionally always on top.
- Let users organize phrases by game and group, with full create, edit, reorder, and delete operations.
- Support compact title-only rows and expanded full-sentence rows.
- Support favorites, search, session-only recent copies, editable variable presets, and optional per-phrase shortcuts.
- Store all user content locally and provide a safe JSON backup and restore workflow.
- Publish an open-source Windows installer and portable ZIP through GitHub Releases.
- Reach a release-quality standard for visual polish, accessibility, recovery behavior, automated checks, and Windows validation.

## 3. Non-goals

- Pasting into a game, pressing Enter, or automating chat submission.
- Process injection, DirectX overlays, anti-cheat bypasses, or support over exclusive fullscreen games.
- Accounts, cloud sync, telemetry, analytics, advertising, or remote phrase storage.
- macOS or Linux support in the first release.
- Import merging. Restore replaces the current library after validation and an automatic backup.
- Rich text, images, macros, scripting, or non-text clipboard formats.

## 4. Technology and architecture

PartyPaste uses:

- Tauri 2 for the Windows host and native desktop capabilities.
- Rust for application lifecycle, window control, system tray, global shortcuts, clipboard access, persistence commands, and updater integration.
- React and TypeScript for the compact overlay, manager, settings, and reusable UI components.
- SQLite for durable local data.
- JSON with an explicit `schemaVersion` for backup files.

The application is divided into independently testable modules:

1. **Overlay UI** renders the gameplay list, variable form, copy feedback, favorites, and session history.
2. **Manager UI** manages games, groups, phrases, variables, presets, shortcuts, backup, and settings.
3. **Phrase service** validates input, parses templates, resolves variables, searches content, and coordinates clipboard writes.
4. **Shortcut registry** owns global shortcut registration and conflict recovery.
5. **Window and tray service** owns the two-window lifecycle, topmost state, visibility, monitor bounds, and single-instance behavior.
6. **Repository layer** is the only layer allowed to read or write SQLite.
7. **Backup service** validates, exports, safeguards, and restores complete libraries.
8. **Release updater** checks GitHub-hosted update metadata and verifies Tauri update signatures.

React components never construct SQL or directly access the filesystem. Native commands expose typed request and response objects. Persisted changes go through the service layer and a SQLite transaction.

## 5. Window model

### 5.1 Gameplay overlay

- Default size: 300 by 420 logical pixels.
- Minimum size: 240 by 160 logical pixels.
- Resizable and movable, with a custom drag region in the title bar.
- Always on top by default, with a visible pin control to disable or restore topmost behavior.
- Uses a vertical list layout.
- Remembers size, position, selected game, selected display mode, and topmost preference.
- Position is stored per monitor configuration and clamped back into a visible work area if a monitor is removed or resolution changes.
- The close control hides the overlay; it does not terminate PartyPaste.
- A configurable global shortcut shows or hides the overlay. The initial default is `Ctrl+Shift+Space`.

Title-only mode displays phrase titles. Full-sentence mode displays the title and complete sentence with naturally expanding row height. The selected mode is remembered per game.

### 5.2 Manager

- Default size: 1120 by 720 logical pixels.
- Minimum size: 760 by 560 logical pixels.
- A normal, non-topmost window.
- Three-column layout at widths of 1000 logical pixels and above:
  - game and feature navigation;
  - searchable, sortable phrase list;
  - inline inspector for the selected record.
- Below 1000 logical pixels, the inspector becomes an accessible drawer.
- Closing the manager leaves PartyPaste running in the system tray.

### 5.3 System tray and lifecycle

- PartyPaste is single-instance. A second launch focuses or restores the existing instance.
- The tray menu provides Show/Hide Overlay, Open Manager, Check for Updates, and Quit.
- Quit is explicit. Closing either window alone never silently terminates the tray process.

## 6. Visual design

The approved direction is **Warm Adventure Terminal**:

- Deep ink-green surfaces inspired by subdued game utilities.
- Amber as the primary action and focus color.
- Warm off-white primary text and muted sage secondary text.
- Low-noise borders, restrained shadows, compact spacing, and clear grouping.
- Press Start 2P is bundled and used only for short English brand or status labels such as `PARTYPASTE` and `GAMES`.
- Noto Sans TC is bundled for Traditional Chinese and general UI text. A suitable Latin monospace face is bundled for shortcut labels and technical tokens.
- Font license notices are included with the application and repository.

Interactive state is never conveyed by color alone. Focus rings, icons, text labels, and selected shapes remain visible at supported scaling levels. The application supports keyboard navigation, logical focus order, accessible names, reduced-motion preferences, and Windows scaling at 100%, 150%, and 200%.

## 7. Information architecture and operations

Each game owns its groups, phrases, overlay preferences, and common-variable library. A phrase belongs to exactly one group. Favorites are a synthetic view within the currently selected game; favoriting does not move or duplicate the phrase.

The manager supports:

- creating, renaming, reordering, and deleting games;
- creating, renaming, collapsing, reordering, and deleting groups;
- creating, editing, reordering, moving, duplicating, favoriting, and deleting phrases;
- drag-and-drop ordering plus keyboard and menu alternatives for move up, move down, and move to group;
- normalized substring search across the selected game's phrase title, body, and shortcut;
- filters for favorites, templates, and assigned shortcuts.

Deletion is recoverable through a short-lived Undo action. Destructive group or game deletion also requires a confirmation that states how many child records are affected. Database writes remain transactional even while Undo is available.

## 8. Phrase copying

### 8.1 Plain phrases

1. The user clicks a phrase or invokes its optional shortcut.
2. The service reads and validates the current phrase.
3. PartyPaste writes Unicode plain text to the Windows clipboard.
4. On success, the overlay displays a non-blocking confirmation for approximately 1.5 seconds.
5. The successful result is appended to in-memory recent history.

Recent history holds at most 30 successful copies and is cleared when the process exits. Failed clipboard writes are never added.

If the clipboard is temporarily unavailable, the native layer performs a small bounded retry. If it still fails, the UI displays a persistent, actionable error and leaves the phrase available for another click.

### 8.2 Favorites

Favorites appear as a synthetic group at the top of the selected game's overlay and as a manager filter. A phrase remains owned by its original group. Reordering a favorites view changes only favorite ordering, not the phrase's group ordering.

### 8.3 Search

Search is available in the manager and filters as the user types. It is scoped to the selected game and matches titles, sentence bodies, and shortcut labels without requiring a full-text search server.

## 9. Templates and editable common variables

### 9.1 Syntax

Variables use `{name}` syntax, for example:

`徵 {人數} 位隊友，預計 {時間} 開打`

Literal braces use `{{` and `}}`. Nested variables, empty names, control characters, and unbalanced braces are invalid. Variables are text values only in the first release.

### 9.2 Common-variable library

Every game has an independent, user-editable common-variable library. A variable definition has a unique name within its game and an ordered list of common values. Users can create, rename, delete, and reorder definitions and values.

Example definitions:

- `{人數}`: `1`, `2`, `3`, `4`
- `{時間}`: `20:00`, `20:30`, `21:00`, `21:30`
- `{集合地點}`: user-defined locations

When a template opens, matching common values appear as one-click choices. A free-text input remains available for temporary values. Temporary values are not remembered after the form closes, preserving the approved privacy behavior.

Renaming a variable first shows the number of affected phrases. On confirmation, the definition, phrase tokens, and reference records update in one transaction. Deleting a definition removes its common-value assistance but does not delete or corrupt phrases; affected tokens become free-text fields.

Unknown variables in an imported or existing phrase are valid free-text fields. Saving a phrase refreshes its stable variable-reference records.

### 9.3 Template overlay flow

- Clicking a template expands a compact form inside the overlay.
- Common-value chips appear before the custom input.
- A live preview shows the exact final sentence.
- Copy remains disabled until every variable has a non-empty value.
- `Escape` collapses the form without writing to the clipboard.
- A shortcut assigned to a template shows the overlay and opens its form; it never copies an incomplete template.

## 10. Global shortcuts

The show/hide shortcut and every per-phrase shortcut are user-configurable. Per-phrase shortcuts are optional and unassigned by default.

Shortcut rules:

- Accelerators must include at least one modifier key.
- PartyPaste rejects duplicates within its own configuration before asking Windows to register them.
- If Windows rejects a shortcut because another application owns it, PartyPaste shows a clear conflict and preserves the previous working shortcut.
- A plain phrase shortcut copies immediately and displays feedback when the overlay is visible.
- A template shortcut opens the overlay and its variable form.
- Shortcut registrations are rebuilt after import and on startup. Individual conflicts do not prevent the remaining valid shortcuts from registering.

## 11. Data model

SQLite contains these conceptual tables:

- `games`: identity, name, order, and overlay preferences.
- `groups`: game ownership, name, collapsed state, and order.
- `phrases`: group ownership, title, body template, favorite state, favorite order, optional hotkey, and group order.
- `variable_definitions`: game ownership, unique normalized name, and order.
- `variable_presets`: variable ownership, value, and order.
- `phrase_variable_refs`: stable links between phrases and variable definitions, including token order.
- `settings`: application language, update-check state, window state, and other application preferences.
- `schema_migrations`: applied database schema versions.

Recommended validation boundaries:

- game and group names: 1 to 80 Unicode scalar values after trimming;
- phrase title: 1 to 120;
- phrase body: 1 to 4000;
- variable name: 1 to 40, excluding braces and control characters;
- variable preset: 1 to 200;
- variable names are unique per game after Unicode normalization and case folding for applicable scripts.

Integer sort positions are reindexed within a transaction after reorder operations. Foreign keys are enabled. Deleting parents uses explicit service behavior rather than relying on an invisible cascade from the UI.

## 12. Backup and restore

Export produces one UTF-8 JSON file containing:

- `schemaVersion`;
- export timestamp and PartyPaste version;
- all games, groups, phrases, favorites, ordering, shortcuts, variable definitions, and presets;
- user preferences that are safe and useful to move between machines.

Recent history, window coordinates, updater secrets, and machine-specific paths are excluded.

Restore uses complete replacement only:

1. Read a user-selected file with a 10 MiB safety limit.
2. Parse and validate the full structure and supported `schemaVersion` without changing current data.
3. Display a summary of games, groups, phrases, variables, and shortcut conflicts.
4. After confirmation, write a timestamped automatic backup of the current library.
5. Replace the database content inside one transaction.
6. Rebuild shortcuts and report conflicts without rolling back otherwise valid content.

Any parse, validation, backup, or transaction failure leaves the active library unchanged. PartyPaste retains the five most recent automatic pre-import or pre-migration backups.

## 13. Error handling and recovery

- **Shortcut conflict:** reject only the new registration, retain the previous working value, and identify the affected action.
- **Clipboard unavailable:** bounded retry, then show an actionable error without modifying recent history.
- **Invalid template:** block save or copy and highlight the exact invalid token.
- **Database write failure:** roll back the transaction and keep the UI's last confirmed state.
- **Migration failure:** restore the pre-migration backup and open a recovery screen rather than starting with a partially migrated database.
- **Invalid backup:** make no changes and provide a concise validation summary.
- **Offline update check:** automatic checks fail quietly; manually requested checks display a non-blocking error.
- **Off-screen window:** clamp saved bounds into the nearest active monitor work area.
- **Unsupported exclusive fullscreen:** show documentation directing the user to borderless-windowed mode; do not attempt injection or elevated workarounds.

Logs contain technical errors but never phrase bodies, resolved template values, clipboard contents, or other user-authored text.

## 14. Localization

The UI ships with `zh-TW` and `en` message catalogs. On first launch, PartyPaste follows the Windows display language and falls back to English. Users can switch languages in Settings without changing phrase content.

Automated checks fail if either catalog is missing a required key. Layout tests cover representative long English strings and Traditional Chinese at supported scaling levels.

## 15. Privacy and security

- No account, analytics, advertising, telemetry, or phrase synchronization.
- The only routine network request is the low-frequency GitHub Releases update check.
- Automatic update checking occurs at most once every 24 hours during startup or process activation.
- Tauri capabilities grant only the native commands required by the relevant window.
- A restrictive content security policy disallows remote scripts and arbitrary navigation.
- Backup input is size-limited and schema-validated before allocation-heavy or persistent work.
- Updater private keys and Windows signing credentials live only in protected release secrets, never in the repository.
- User content remains in the application data directory for the installed build or beside the executable in the portable build.

## 16. Packaging, update, and GitHub publication

GitHub Releases provides:

- a per-user NSIS Windows installer;
- a portable ZIP containing the executable, a portable-mode marker, bundled font notices, and a local data directory;
- release notes;
- SHA-256 hashes;
- Tauri updater artifacts and signatures;
- repository source code under the MIT License.

Installed builds can download a signed updater artifact after the user approves the update prompt. Portable builds notify the user and open the matching GitHub Release download page so the portable folder is never replaced unexpectedly.

The installed uninstaller preserves user data by default. Data deletion is a separate, explicit action exposed in PartyPaste before uninstall. Removing a portable folder removes its colocated data, so the UI advises exporting a backup first.

Beta releases may be distributed without Windows Authenticode signing and must clearly disclose the possible SmartScreen warning. Tauri updater signatures remain mandatory. The stable 1.0 release requires Authenticode signing and validation on clean Windows environments.

## 17. Testing strategy

### 17.1 Unit tests

- Template parsing, brace escaping, invalid tokens, and preview resolution.
- Variable definition normalization, preset ordering, rename impact, and deletion fallback.
- Phrase ordering, favorites ordering, search, and validation boundaries.
- Shortcut normalization, internal duplicates, and registration error mapping.
- Backup schema validation, unsupported versions, and import summaries.
- Localization catalog completeness.

### 17.2 Integration tests

- SQLite migrations, foreign keys, transactions, rollback, and backup retention.
- Atomic variable renames across definitions, phrase bodies, and reference records.
- Complete-replacement import with pre-import backup and failure rollback.
- Typed Tauri commands and permission boundaries.
- Clipboard success and failure mapping.
- Shortcut rebuild behavior with partial conflicts.
- Installed and portable data-location selection.

### 17.3 UI and accessibility tests

- React component behavior for overlay modes, template forms, manager filters, drawers, Undo, and errors.
- Keyboard-only creation, editing, reordering, copying, and navigation.
- Visible focus states, accessible names, and contrast.
- Visual regression at compact overlay widths and manager breakpoints.
- Traditional Chinese and English at 100%, 150%, and 200% scaling.

### 17.4 Windows acceptance tests

- Clean supported Windows 10 and Windows 11 environments.
- Single and multiple monitors, including monitor removal and changed resolution.
- System tray lifecycle, single instance, show/hide shortcut, per-phrase shortcuts, and conflict handling.
- Topmost behavior over normal, windowed-game, and borderless-game windows.
- Explicit confirmation that exclusive fullscreen is documented as unsupported.
- Unicode clipboard content in representative games and ordinary Windows text fields.
- NSIS install, upgrade, uninstall-with-data-preservation, and portable ZIP behavior.
- GitHub update discovery, user confirmation, signature verification, and offline behavior.

## 18. Continuous integration and release gates

Every pull request runs TypeScript formatting, linting, type checking, unit tests, Rust formatting, Clippy, Rust tests, and relevant integration tests. Release workflows additionally build the Windows installer and portable ZIP, generate hashes, and produce updater signatures.

A GitHub Release is created only after automated checks pass. A beta also requires the Windows acceptance checklist for its candidate artifacts. Stable 1.0 additionally requires Authenticode signing and a clean-VM install and update test.

## 19. Acceptance criteria

PartyPaste is ready for the first public beta when:

- all goals in this specification are implemented;
- title-only and full-sentence overlay modes work and persist per game;
- plain and template phrases copy correct Unicode text without game automation;
- games, groups, phrases, favorites, ordering, variables, presets, and shortcuts survive restart;
- backup export and safe complete-replacement restore pass failure and rollback tests;
- the overlay, manager, tray, shortcuts, and monitor recovery pass Windows acceptance checks;
- Traditional Chinese and English interfaces pass keyboard and visual checks;
- GitHub Releases contains the installer, portable ZIP, hashes, updater signature, release notes, source, and MIT license;
- known exclusive-fullscreen and beta-signing limitations are prominently documented.
