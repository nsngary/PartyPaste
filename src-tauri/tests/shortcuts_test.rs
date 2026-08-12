use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use partypaste_lib::db::models::{
    GameRecord, GroupRecord, LibrarySnapshot, OverlayDisplayMode, PhraseRecord, SettingRecord,
};
use partypaste_lib::services::shortcuts::{
    ShortcutAction, ShortcutError, ShortcutEvent, ShortcutPort, ShortcutRegistry,
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
