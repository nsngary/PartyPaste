use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use partypaste_lib::commands::settings::ShortcutSettingsState;
use partypaste_lib::db::Repository;
use partypaste_lib::db::models::{
    GameRecord, GroupRecord, LibrarySnapshot, OverlayDisplayMode, PhraseRecord, SettingRecord,
};
use partypaste_lib::services::library::{LibraryService, UpdatePhraseInput};
use partypaste_lib::services::shortcuts::{
    ShortcutAction, ShortcutError, ShortcutEvent, ShortcutMutationError, ShortcutPort,
    ShortcutRegistry, ShortcutRegistryHandle,
};

#[derive(Clone, Default)]
struct FakeShortcutPort(Arc<Mutex<FakeState>>);

#[derive(Default)]
struct FakeState {
    registered: HashSet<String>,
    rejected: HashSet<String>,
    registrations: Vec<String>,
    unregistrations: Vec<String>,
}

impl FakeShortcutPort {
    fn reject(&self, accelerator: &str) {
        self.0.lock().unwrap().rejected.insert(accelerator.into());
    }

    fn registered(&self) -> HashSet<String> {
        self.0.lock().unwrap().registered.clone()
    }

    fn registrations(&self) -> Vec<String> {
        self.0.lock().unwrap().registrations.clone()
    }

    fn unregistrations(&self) -> Vec<String> {
        self.0.lock().unwrap().unregistrations.clone()
    }
}

impl ShortcutPort for FakeShortcutPort {
    fn register(&self, accelerator: &str) -> Result<(), ShortcutError> {
        let mut state = self.0.lock().unwrap();
        state.registrations.push(accelerator.into());
        if state.rejected.contains(accelerator) || !state.registered.insert(accelerator.into()) {
            return Err(ShortcutError::RegistrationRejected);
        }
        Ok(())
    }

    fn unregister(&self, accelerator: &str) -> Result<(), ShortcutError> {
        let mut state = self.0.lock().unwrap();
        state.unregistrations.push(accelerator.into());
        state.registered.remove(accelerator);
        Ok(())
    }
}

fn snapshot(overlay: &str, phrases: &[(&str, &str, &str)]) -> LibrarySnapshot {
    LibrarySnapshot {
        games: vec![GameRecord {
            id: "game".into(),
            name: "Game".into(),
            sort_order: 0,
            overlay_display_mode: OverlayDisplayMode::Title,
        }],
        groups: vec![GroupRecord {
            id: "group".into(),
            game_id: "game".into(),
            name: "Group".into(),
            collapsed: false,
            sort_order: 0,
        }],
        phrases: phrases
            .iter()
            .enumerate()
            .map(|(sort_order, (id, body_template, hotkey))| PhraseRecord {
                id: (*id).into(),
                group_id: "group".into(),
                title: (*id).into(),
                body_template: (*body_template).into(),
                favorite: false,
                favorite_order: None,
                hotkey: (!hotkey.is_empty()).then(|| (*hotkey).into()),
                sort_order: sort_order as i64,
            })
            .collect(),
        settings: vec![SettingRecord {
            key: "overlay_shortcut".into(),
            value: overlay.into(),
        }],
        ..LibrarySnapshot::default()
    }
}

#[test]
fn rejects_modifierless_and_normalized_duplicate_accelerators_before_registration() {
    let port = FakeShortcutPort::default();
    let mut registry = ShortcutRegistry::new(port.clone());
    registry.rebuild(&snapshot("Ctrl+Shift+Space", &[]));

    assert_eq!(
        registry.replace(ShortcutAction::Phrase("phrase".into()), "P"),
        Err(ShortcutError::ModifierRequired)
    );
    assert_eq!(
        registry.replace(
            ShortcutAction::Phrase("phrase".into()),
            "control + shift + space"
        ),
        Err(ShortcutError::Duplicate)
    );
    assert_eq!(port.registrations(), ["Ctrl+Shift+Space"]);
}

#[test]
fn rejected_replacement_restores_the_previous_working_registration() {
    let port = FakeShortcutPort::default();
    let mut registry = ShortcutRegistry::new(port.clone());
    registry.rebuild(&snapshot("Ctrl+Shift+Space", &[]));
    port.reject("Ctrl+Shift+P");

    assert_eq!(
        registry.replace(ShortcutAction::Overlay, "Ctrl+Shift+P"),
        Err(ShortcutError::RegistrationRejected)
    );
    assert_eq!(registry.shortcuts().overlay, "Ctrl+Shift+Space");
    assert_eq!(
        port.registered(),
        HashSet::from(["Ctrl+Shift+Space".into()])
    );
    assert_eq!(port.unregistrations(), ["Ctrl+Shift+Space"]);
    assert_eq!(
        port.registrations(),
        ["Ctrl+Shift+Space", "Ctrl+Shift+P", "Ctrl+Shift+Space"]
    );
}

#[test]
fn rebuild_keeps_unrelated_shortcuts_when_one_os_registration_conflicts_and_releases_all_on_shutdown()
 {
    let port = FakeShortcutPort::default();
    port.reject("Ctrl+Shift+2");
    let mut registry = ShortcutRegistry::new(port.clone());

    let result = registry.rebuild(&snapshot(
        "Ctrl+Shift+Space",
        &[
            ("one", "ready", "Ctrl+Shift+1"),
            ("two", "ready", "Ctrl+Shift+2"),
        ],
    ));

    assert_eq!(result.conflicts, vec![ShortcutAction::Phrase("two".into())]);
    assert_eq!(
        port.registered(),
        HashSet::from(["Ctrl+Shift+Space".into(), "Ctrl+Shift+1".into()])
    );
    registry.shutdown();
    assert!(port.registered().is_empty());
}

#[test]
fn phrase_events_copy_plain_phrases_immediately_and_open_templates_in_the_overlay() {
    let port = FakeShortcutPort::default();
    let mut registry = ShortcutRegistry::new(port);
    registry.rebuild(&snapshot(
        "Ctrl+Shift+Space",
        &[
            ("plain", "ready", "Ctrl+Shift+1"),
            ("template", "Hi {name}", "Ctrl+Shift+2"),
        ],
    ));

    assert_eq!(
        registry.event_for("Ctrl+Shift+1"),
        Some(ShortcutEvent::CopyPhrase {
            phrase_id: "plain".into()
        })
    );
    assert_eq!(
        registry.event_for("Ctrl+Shift+2"),
        Some(ShortcutEvent::ShowOverlay {
            open_template_phrase_id: Some("template".into())
        })
    );
}

#[test]
fn shortcut_events_serialize_with_the_shared_camel_case_contract() {
    let expected: serde_json::Value = serde_json::from_str(include_str!(
        "../../src/features/settings/shortcut-event-fixtures.json"
    ))
    .unwrap();
    let actual = serde_json::to_value([
        ShortcutEvent::CopyPhrase {
            phrase_id: "plain".into(),
        },
        ShortcutEvent::ShowOverlay {
            open_template_phrase_id: Some("template".into()),
        },
        ShortcutEvent::ShowOverlay {
            open_template_phrase_id: None,
        },
    ])
    .unwrap();

    assert_eq!(actual, expected);
}

#[test]
fn persistence_failure_restores_overlay_phrase_replacement_and_phrase_removal() {
    let port = FakeShortcutPort::default();
    let mut registry = ShortcutRegistry::new(port.clone());
    registry.rebuild(&snapshot(
        "Ctrl+Shift+Space",
        &[("plain", "ready", "Ctrl+F1")],
    ));
    let before = port.registered();

    assert_eq!(
        registry.replace_transactional(ShortcutAction::Overlay, "Ctrl+Shift+O", false, |_| Err::<
            (),
            _,
        >(
            "database"
        ),),
        Err(ShortcutMutationError::Persistence("database"))
    );
    assert_eq!(port.registered(), before);
    assert_eq!(registry.shortcuts().overlay, "Ctrl+Shift+Space");
    assert_eq!(
        registry.event_for("Ctrl+Shift+Space"),
        Some(ShortcutEvent::ShowOverlay {
            open_template_phrase_id: None
        })
    );

    assert_eq!(
        registry.replace_transactional(
            ShortcutAction::Phrase("plain".into()),
            "Ctrl+F2",
            false,
            |_| Err::<(), _>("database"),
        ),
        Err(ShortcutMutationError::Persistence("database"))
    );
    assert_eq!(port.registered(), before);
    assert_eq!(registry.shortcuts().phrases["plain"], "Ctrl+F1");
    assert!(matches!(
        registry.event_for("Ctrl+F1"),
        Some(ShortcutEvent::CopyPhrase { .. })
    ));

    assert_eq!(
        registry.remove_transactional(&ShortcutAction::Phrase("plain".into()), || Err::<(), _>(
            "database"
        ),),
        Err(ShortcutMutationError::Persistence("database"))
    );
    assert_eq!(port.registered(), before);
    assert_eq!(registry.shortcuts().phrases["plain"], "Ctrl+F1");
    assert!(matches!(
        registry.event_for("Ctrl+F1"),
        Some(ShortcutEvent::CopyPhrase { .. })
    ));
}

#[test]
fn function_and_named_keys_are_canonical_and_duplicate_case_insensitively() {
    let port = FakeShortcutPort::default();
    let mut registry = ShortcutRegistry::new(port);
    registry.rebuild(&snapshot("Ctrl+F1", &[]));

    assert_eq!(registry.event_for("CTRL+f1"), registry.event_for("ctrl+F1"));
    assert_eq!(
        registry.replace(ShortcutAction::Phrase("phrase".into()), "control+f1"),
        Err(ShortcutError::Duplicate)
    );
    assert_eq!(
        partypaste_lib::services::shortcuts::normalize_shortcut("shift+CTRL+pageup"),
        "Ctrl+Shift+PageUp"
    );
}

#[test]
fn startup_rebuilds_once_and_drop_releases_every_registration() {
    let port = FakeShortcutPort::default();
    let mut repository = Repository::in_memory().unwrap();
    repository
        .replace_snapshot(&snapshot(
            "Ctrl+Shift+Space",
            &[("plain", "ready", "Ctrl+F1")],
        ))
        .unwrap();

    let state = ShortcutSettingsState::new(repository, port.clone()).unwrap();
    assert_eq!(port.registrations(), ["Ctrl+Shift+Space", "Ctrl+F1"]);
    drop(state);
    assert!(port.registered().is_empty());
}

#[test]
fn library_mutation_hook_rebuilds_delete_update_and_undo_shortcut_state() {
    let port = FakeShortcutPort::default();
    let initial = snapshot("Ctrl+Shift+Space", &[("plain", "ready", "Ctrl+F1")]);
    let mut repository = Repository::in_memory().unwrap();
    repository.replace_snapshot(&initial).unwrap();
    let registry = ShortcutRegistryHandle::new(port.clone());
    registry.rebuild(&initial);
    let mut library = LibraryService::with_mutation_hook(repository, registry.clone());

    let updated = library
        .update_phrase(UpdatePhraseInput {
            id: "plain".into(),
            title: "plain".into(),
            body_template: "Hi {name}".into(),
            hotkey: Some("Ctrl+F1".into()),
        })
        .unwrap();
    assert_eq!(
        registry.event_for("Ctrl+F1"),
        Some(ShortcutEvent::ShowOverlay {
            open_template_phrase_id: Some("plain".into())
        })
    );

    let deleted = library.delete_phrase("plain").unwrap();
    assert!(registry.event_for("Ctrl+F1").is_none());
    library.undo_operation(&deleted.undo.operation_id).unwrap();
    assert!(matches!(
        registry.event_for("Ctrl+F1"),
        Some(ShortcutEvent::ShowOverlay { .. })
    ));
    library.undo_operation(&updated.undo.operation_id).unwrap();
    assert_eq!(
        registry.event_for("Ctrl+F1"),
        Some(ShortcutEvent::CopyPhrase {
            phrase_id: "plain".into()
        })
    );
}
