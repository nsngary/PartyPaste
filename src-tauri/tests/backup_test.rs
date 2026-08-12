use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use partypaste_lib::db::Repository;
use partypaste_lib::db::models::{
    GameRecord, GroupRecord, LibrarySnapshot, OverlayDisplayMode, PhraseRecord, SettingRecord,
    VariableDefinitionRecord,
};
use partypaste_lib::paths::DataPaths;
use partypaste_lib::services::backup::{BackupDocumentV1, BackupError, BackupService};
use partypaste_lib::services::library::LibraryMutationHook;
use partypaste_lib::services::shortcuts::{
    ShortcutError, ShortcutEvent, ShortcutPort, ShortcutRegistryHandle,
};

#[derive(Clone, Default)]
struct RecordingHook(Arc<Mutex<Vec<LibrarySnapshot>>>);

impl RecordingHook {
    fn calls(&self) -> usize {
        self.0.lock().unwrap().len()
    }
}

impl LibraryMutationHook for RecordingHook {
    fn library_changed(&mut self, snapshot: &LibrarySnapshot) {
        self.0.lock().unwrap().push(snapshot.clone());
    }
}

#[derive(Clone, Default)]
struct ShortcutPortForRestore(Arc<Mutex<HashSet<String>>>);

impl ShortcutPort for ShortcutPortForRestore {
    fn register(&self, accelerator: &str) -> Result<(), ShortcutError> {
        if self.0.lock().unwrap().insert(accelerator.into()) {
            Ok(())
        } else {
            Err(ShortcutError::RegistrationRejected)
        }
    }

    fn unregister(&self, accelerator: &str) -> Result<(), ShortcutError> {
        self.0.lock().unwrap().remove(accelerator);
        Ok(())
    }
}

fn test_paths(label: &str) -> DataPaths {
    let root = std::env::temp_dir().join(format!(
        "partypaste-backup-test-{label}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    DataPaths {
        database: root.join("partypaste.db"),
        backups: root.join("backups"),
        logs: root.join("logs"),
        portable: false,
    }
}

fn snapshot() -> LibrarySnapshot {
    LibrarySnapshot {
        games: vec![GameRecord {
            id: "game".into(),
            name: "遊戲".into(),
            sort_order: 0,
            overlay_display_mode: OverlayDisplayMode::Full,
        }],
        groups: vec![GroupRecord {
            id: "group".into(),
            game_id: "game".into(),
            name: "隊伍".into(),
            collapsed: false,
            sort_order: 0,
        }],
        phrases: vec![PhraseRecord {
            id: "phrase".into(),
            group_id: "group".into(),
            title: "你好".into(),
            body_template: "大家好".into(),
            favorite: true,
            favorite_order: Some(0),
            hotkey: Some("Ctrl+Shift+1".into()),
            sort_order: 0,
        }],
        variable_definitions: vec![VariableDefinitionRecord {
            id: "variable".into(),
            game_id: "game".into(),
            name: "Ｐｌａｙｅｒ".into(),
            normalized_name: "player".into(),
            sort_order: 0,
        }],
        settings: vec![
            SettingRecord {
                key: "overlay_shortcut".into(),
                value: "Ctrl+Shift+Space".into(),
            },
            SettingRecord {
                key: "window_bounds".into(),
                value: "machine-only".into(),
            },
        ],
        ..LibrarySnapshot::default()
    }
}

fn service(paths: &DataPaths, hook: RecordingHook) -> BackupService {
    let mut repository = Repository::open(paths.clone()).unwrap();
    repository.replace_snapshot(&snapshot()).unwrap();
    BackupService::with_mutation_hook(repository, paths.clone(), hook)
}

fn write_document(path: &PathBuf, document: &BackupDocumentV1) {
    fs::write(path, serde_json::to_vec(document).unwrap()).unwrap();
}

#[test]
fn export_is_stable_utf8_versioned_and_excludes_machine_only_state() {
    let paths = test_paths("stable-export");
    let hook = RecordingHook::default();
    let service = service(&paths, hook);
    let first = paths.database.with_file_name("first.json");
    let second = paths.database.with_file_name("second.json");

    service.export_backup(&first).unwrap();
    service.export_backup(&second).unwrap();

    let bytes = fs::read(&first).unwrap();
    assert_eq!(bytes, fs::read(&second).unwrap());
    assert!(std::str::from_utf8(&bytes).is_ok());
    let document: BackupDocumentV1 = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(document.schema_version, 1);
    assert_eq!(document.library.games[0].name, "遊戲");
    assert!(
        document
            .library
            .settings
            .iter()
            .all(|setting| !setting.key.starts_with("window_"))
    );
}

#[test]
fn preview_rejects_all_invalid_boundaries_without_changing_the_active_library() {
    let paths = test_paths("invalid-imports");
    let hook = RecordingHook::default();
    let mut service = service(&paths, hook);
    let before = serde_json::to_vec(&service.snapshot().unwrap()).unwrap();
    let import = paths.database.with_file_name("import.json");

    let invalid_documents = vec![
        b"{".to_vec(),
        br#"{"schemaVersion":2,"library":{}}"#.to_vec(),
        vec![b'x'; 10 * 1024 * 1024 + 1],
        serde_json::to_vec(&BackupDocumentV1 {
            schema_version: 1,
            library: LibrarySnapshot {
                games: vec![snapshot().games[0].clone(), snapshot().games[0].clone()],
                ..LibrarySnapshot::default()
            },
        })
        .unwrap(),
        serde_json::to_vec(&BackupDocumentV1 {
            schema_version: 1,
            library: LibrarySnapshot {
                games: vec![snapshot().games[0].clone()],
                variable_definitions: vec![
                    VariableDefinitionRecord {
                        id: "one".into(),
                        game_id: "game".into(),
                        name: "Straße".into(),
                        normalized_name: "strasse".into(),
                        sort_order: 0,
                    },
                    VariableDefinitionRecord {
                        id: "two".into(),
                        game_id: "game".into(),
                        name: "STRASSE".into(),
                        normalized_name: "strasse".into(),
                        sort_order: 1,
                    },
                ],
                ..LibrarySnapshot::default()
            },
        })
        .unwrap(),
    ];

    for bytes in invalid_documents {
        fs::write(&import, bytes).unwrap();
        assert!(matches!(
            service.preview_import(&import),
            Err(BackupError::Invalid)
        ));
        assert_eq!(
            serde_json::to_vec(&service.snapshot().unwrap()).unwrap(),
            before
        );
    }
}

#[test]
fn preview_token_is_short_lived_and_bound_to_the_validated_file_content() {
    let paths = test_paths("preview-token");
    let hook = RecordingHook::default();
    let mut service = service(&paths, hook.clone());
    let import = paths.database.with_file_name("import.json");
    let document = BackupDocumentV1::from_snapshot(&snapshot());
    write_document(&import, &document);
    let preview = service.preview_import(&import).unwrap();

    let mut changed = document;
    changed.library.phrases[0].title = "changed".into();
    write_document(&import, &changed);
    assert!(matches!(
        service.replace_from_backup(&import, &preview.preview_token),
        Err(BackupError::Invalid)
    ));
    assert_eq!(hook.calls(), 0);
}

#[test]
fn expired_preview_token_leaves_the_active_library_byte_identical() {
    let paths = test_paths("expired-preview");
    let now = Arc::new(AtomicU64::new(100));
    let mut repository = Repository::open(paths.clone()).unwrap();
    repository.replace_snapshot(&snapshot()).unwrap();
    let clock = now.clone();
    let mut service = BackupService::with_clock(repository, paths.clone(), move || {
        clock.load(Ordering::Relaxed)
    });
    let before = serde_json::to_vec(&service.snapshot().unwrap()).unwrap();
    let import = paths.database.with_file_name("import.json");
    write_document(&import, &BackupDocumentV1::from_snapshot(&snapshot()));
    let preview = service.preview_import(&import).unwrap();

    now.store(300_100, Ordering::Relaxed);
    assert!(matches!(
        service.replace_from_backup(&import, &preview.preview_token),
        Err(BackupError::Invalid)
    ));
    assert_eq!(
        serde_json::to_vec(&service.snapshot().unwrap()).unwrap(),
        before
    );
}

#[test]
fn preview_reports_counts_and_rejects_references_and_noncontiguous_orders() {
    let paths = test_paths("invariants");
    let hook = RecordingHook::default();
    let mut service = service(&paths, hook);
    let import = paths.database.with_file_name("import.json");
    let mut valid = BackupDocumentV1::from_snapshot(&snapshot());
    valid.library.phrases[0].hotkey = Some("ctrl + shift + space".into());
    write_document(&import, &valid);
    let preview = service.preview_import(&import).unwrap();
    assert_eq!(preview.game_count, 1);
    assert_eq!(preview.group_count, 1);
    assert_eq!(preview.phrase_count, 1);
    assert_eq!(preview.shortcut_conflict_count, 1);

    valid.library.groups[0].sort_order = 4;
    write_document(&import, &valid);
    assert!(matches!(
        service.preview_import(&import),
        Err(BackupError::Invalid)
    ));

    let mut invalid_reference = BackupDocumentV1::from_snapshot(&snapshot());
    invalid_reference.library.phrase_variable_refs.push(
        partypaste_lib::db::models::PhraseVariableRefRecord {
            phrase_id: "phrase".into(),
            variable_definition_id: "variable".into(),
            token_order: 0,
        },
    );
    write_document(&import, &invalid_reference);
    assert!(matches!(
        service.preview_import(&import),
        Err(BackupError::Invalid)
    ));
}

#[test]
fn replacement_creates_a_retained_safety_backup_and_rebuilds_shortcuts() {
    let paths = test_paths("restore");
    let hook = RecordingHook::default();
    let mut service = service(&paths, hook.clone());
    let import = paths.database.with_file_name("import.json");

    for index in 0..6 {
        let mut document = BackupDocumentV1::from_snapshot(&snapshot());
        document.library.games[0].name = format!("Game {index}");
        write_document(&import, &document);
        let preview = service.preview_import(&import).unwrap();
        service
            .replace_from_backup(&import, &preview.preview_token)
            .unwrap();
    }

    assert_eq!(service.snapshot().unwrap().games[0].name, "Game 5");
    assert_eq!(hook.calls(), 6);
    assert_eq!(
        fs::read_dir(&paths.backups)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("pre-import-"))
            .count(),
        5
    );
}

#[test]
fn restore_rebuilds_successful_shortcuts_when_an_imported_shortcut_conflicts() {
    let paths = test_paths("shortcut-rebuild");
    let port = ShortcutPortForRestore::default();
    let registry = ShortcutRegistryHandle::new(port);
    let mut repository = Repository::open(paths.clone()).unwrap();
    repository.replace_snapshot(&snapshot()).unwrap();
    let mut service =
        BackupService::with_mutation_hook(repository, paths.clone(), registry.clone());
    let import = paths.database.with_file_name("import.json");
    let mut document = BackupDocumentV1::from_snapshot(&snapshot());
    document.library.phrases.push(PhraseRecord {
        id: "conflicting".into(),
        group_id: "group".into(),
        title: "Conflicting".into(),
        body_template: "plain".into(),
        favorite: false,
        favorite_order: None,
        hotkey: Some("ctrl + shift + 1".into()),
        sort_order: 1,
    });
    write_document(&import, &document);
    let preview = service.preview_import(&import).unwrap();
    assert_eq!(preview.shortcut_conflict_count, 1);

    service
        .replace_from_backup(&import, &preview.preview_token)
        .unwrap();
    assert_eq!(
        registry.event_for("Ctrl+Shift+1"),
        Some(ShortcutEvent::CopyPhrase {
            phrase_id: "phrase".into(),
        })
    );
}
