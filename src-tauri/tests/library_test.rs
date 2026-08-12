use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use partypaste_lib::db::Repository;
use partypaste_lib::services::library::{
    CreateGameInput, CreateGroupInput, CreatePhraseInput, LibraryService, LibraryServiceError,
    SaveVariableDefinition, SaveVariablePreset, UpdateGameInput, UpdateGroupInput,
    UpdatePhraseInput, VariableService,
};

fn service_at(now: Arc<AtomicU64>) -> LibraryService {
    LibraryService::with_clock(Repository::in_memory().unwrap(), move || {
        now.load(Ordering::SeqCst)
    })
}

fn create_game(service: &mut LibraryService, id: &str, name: &str) {
    service
        .create_game(CreateGameInput {
            id: id.into(),
            name: name.into(),
        })
        .unwrap();
}

fn create_group(service: &mut LibraryService, id: &str, game_id: &str, name: &str) {
    service
        .create_group(CreateGroupInput {
            id: id.into(),
            game_id: game_id.into(),
            name: name.into(),
        })
        .unwrap();
}

fn create_phrase(
    service: &mut LibraryService,
    id: &str,
    group_id: &str,
    title: &str,
    body: &str,
    hotkey: Option<&str>,
) {
    service
        .create_phrase(CreatePhraseInput {
            id: id.into(),
            group_id: group_id.into(),
            title: title.into(),
            body_template: body.into(),
            hotkey: hotkey.map(str::to_owned),
        })
        .unwrap();
}

#[test]
fn library_crud_normalizes_unicode_and_enforces_exact_scalar_limits() {
    let now = Arc::new(AtomicU64::new(1_000));
    let mut service = service_at(now);

    let created = service
        .create_game(CreateGameInput {
            id: "game".into(),
            name: "  Ｇａｍｅ  ".into(),
        })
        .unwrap();
    assert_eq!(created.value.name, "Game");
    service
        .update_game(UpdateGameInput {
            id: "game".into(),
            name: "🎮".repeat(80),
        })
        .unwrap();
    assert!(matches!(
        service.update_game(UpdateGameInput {
            id: "game".into(),
            name: "界".repeat(81),
        }),
        Err(LibraryServiceError::InvalidGameName)
    ));

    create_group(&mut service, "group", "game", &"界".repeat(80));
    assert!(matches!(
        service.update_group(UpdateGroupInput {
            id: "group".into(),
            name: "界".repeat(81),
            collapsed: true,
        }),
        Err(LibraryServiceError::InvalidGroupName)
    ));

    create_phrase(
        &mut service,
        "phrase",
        "group",
        &"🎮".repeat(120),
        &"界".repeat(4000),
        None,
    );
    service
        .update_phrase(UpdatePhraseInput {
            id: "phrase".into(),
            title: "Title".into(),
            body_template: "  intentional space  ".into(),
            hotkey: None,
        })
        .unwrap();
    assert_eq!(
        service
            .get_library()
            .unwrap()
            .phrases
            .iter()
            .find(|phrase| phrase.id == "phrase")
            .unwrap()
            .body_template,
        "  intentional space  "
    );
    assert!(matches!(
        service.update_phrase(UpdatePhraseInput {
            id: "phrase".into(),
            title: "界".repeat(121),
            body_template: "Body".into(),
            hotkey: None,
        }),
        Err(LibraryServiceError::InvalidPhraseTitle)
    ));
    assert!(matches!(
        service.update_phrase(UpdatePhraseInput {
            id: "phrase".into(),
            title: "Title".into(),
            body_template: "界".repeat(4001),
            hotkey: None,
        }),
        Err(LibraryServiceError::InvalidPhraseBody)
    ));
}

#[test]
fn moves_reindex_both_groups_and_favorite_order_is_independent() {
    let now = Arc::new(AtomicU64::new(2_000));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Game");
    create_group(&mut service, "a", "game", "A");
    create_group(&mut service, "b", "game", "B");
    for id in ["p1", "p2", "p3"] {
        create_phrase(&mut service, id, "a", id, id, None);
        service.set_favorite(id, true).unwrap();
    }
    create_phrase(&mut service, "p4", "b", "P4", "P4", None);

    service.move_phrase("p2", "b", 0).unwrap();
    service
        .reorder_favorites("game", &["p3".into(), "p1".into(), "p2".into()])
        .unwrap();
    let snapshot = service.get_library().unwrap();
    let group_a = snapshot
        .phrases
        .iter()
        .filter(|phrase| phrase.group_id == "a")
        .map(|phrase| (phrase.id.as_str(), phrase.sort_order))
        .collect::<Vec<_>>();
    let group_b = snapshot
        .phrases
        .iter()
        .filter(|phrase| phrase.group_id == "b")
        .map(|phrase| (phrase.id.as_str(), phrase.sort_order))
        .collect::<Vec<_>>();
    assert_eq!(group_a, vec![("p1", 0), ("p3", 1)]);
    assert_eq!(group_b, vec![("p2", 0), ("p4", 1)]);
    assert_eq!(
        snapshot
            .phrases
            .iter()
            .filter(|phrase| phrase.favorite)
            .map(|phrase| (phrase.id.as_str(), phrase.favorite_order))
            .collect::<Vec<_>>(),
        vec![("p1", Some(1)), ("p3", Some(0)), ("p2", Some(2))]
    );
}

#[test]
fn search_is_game_scoped_normalized_and_checks_title_body_and_hotkey() {
    let now = Arc::new(AtomicU64::new(3_000));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Game");
    create_game(&mut service, "other", "Other");
    create_group(&mut service, "group", "game", "Group");
    create_group(&mut service, "other-group", "other", "Group");
    create_phrase(&mut service, "title", "group", "Straße", "x", None);
    create_phrase(&mut service, "body", "group", "x", "Ｆｉｎａｌ raid", None);
    create_phrase(
        &mut service,
        "hotkey",
        "group",
        "x",
        "x",
        Some("Ctrl+Shift+R"),
    );
    create_phrase(
        &mut service,
        "foreign",
        "other-group",
        "STRASSE",
        "raid",
        Some("Ctrl+Shift+R"),
    );

    assert_eq!(
        service
            .search_phrases("game", "STRASSE")
            .unwrap()
            .iter()
            .map(|phrase| phrase.id.as_str())
            .collect::<Vec<_>>(),
        vec!["title"]
    );
    assert_eq!(
        service.search_phrases("game", "final").unwrap()[0].id,
        "body"
    );
    assert_eq!(
        service.search_phrases("game", "shift+r").unwrap()[0].id,
        "hotkey"
    );
}

#[test]
fn destructive_impacts_count_children_and_delete_can_be_undone_for_ten_seconds() {
    let now = Arc::new(AtomicU64::new(4_000));
    let mut service = service_at(Arc::clone(&now));
    create_game(&mut service, "game", "Game");
    create_group(&mut service, "a", "game", "A");
    create_group(&mut service, "b", "game", "B");
    create_phrase(&mut service, "p1", "a", "P1", "Body", None);
    create_phrase(&mut service, "p2", "a", "P2", "Body", None);
    create_phrase(&mut service, "p3", "b", "P3", "Body", None);
    VariableService::save_definition(
        service.repository_mut(),
        SaveVariableDefinition {
            id: "variable".into(),
            game_id: "game".into(),
            name: "Count".into(),
            sort_order: 0,
            rename_confirmed: false,
            presets: vec![SaveVariablePreset {
                id: "preset".into(),
                value: "3".into(),
                sort_order: 0,
            }],
        },
    )
    .unwrap();
    service
        .update_phrase(UpdatePhraseInput {
            id: "p1".into(),
            title: "P1".into(),
            body_template: "Need {Count}".into(),
            hotkey: None,
        })
        .unwrap();

    let group_impact = service.group_delete_impact("a").unwrap();
    assert_eq!(group_impact.phrase_count, 2);
    assert_eq!(group_impact.phrase_variable_ref_count, 1);
    let game_impact = service.game_delete_impact("game").unwrap();
    assert_eq!(game_impact.group_count, 2);
    assert_eq!(game_impact.phrase_count, 3);
    assert_eq!(game_impact.variable_definition_count, 1);
    assert_eq!(game_impact.variable_preset_count, 1);
    assert_eq!(game_impact.phrase_variable_ref_count, 1);

    let deleted = service.delete_group("a").unwrap();
    assert_eq!(deleted.value.phrase_count, 2);
    assert_eq!(deleted.undo.expires_at, 14_000);
    now.store(13_999, Ordering::SeqCst);
    service.undo_operation(&deleted.undo.operation_id).unwrap();
    assert_eq!(service.group_delete_impact("a").unwrap().phrase_count, 2);

    let deleted_again = service.delete_group("a").unwrap();
    now.store(deleted_again.undo.expires_at, Ordering::SeqCst);
    assert!(matches!(
        service.undo_operation(&deleted_again.undo.operation_id),
        Err(LibraryServiceError::UndoExpired)
    ));
    assert!(
        service
            .get_library()
            .unwrap()
            .groups
            .iter()
            .all(|group| group.id != "a")
    );
}

#[test]
fn every_unexpired_bounded_journal_receipt_can_be_selected_by_operation_id() {
    let now = Arc::new(AtomicU64::new(7_000));
    let mut service = service_at(now);
    let first = service
        .create_game(CreateGameInput {
            id: "a".into(),
            name: "A".into(),
        })
        .unwrap();
    service
        .create_game(CreateGameInput {
            id: "b".into(),
            name: "B".into(),
        })
        .unwrap();

    service.undo_operation(&first.undo.operation_id).unwrap();
    assert!(service.get_library().unwrap().games.is_empty());
}

#[test]
fn duplicate_update_delete_and_all_complete_reorders_return_current_state() {
    let now = Arc::new(AtomicU64::new(5_000));
    let mut service = service_at(now);
    create_game(&mut service, "a", "A");
    create_game(&mut service, "b", "B");
    create_group(&mut service, "g1", "a", "G1");
    create_group(&mut service, "g2", "a", "G2");
    create_phrase(&mut service, "p1", "g1", "P1", "Body", None);
    create_phrase(&mut service, "p2", "g1", "P2", "Body", None);

    service.reorder_games(&["b".into(), "a".into()]).unwrap();
    service
        .reorder_groups("a", &["g2".into(), "g1".into()])
        .unwrap();
    service
        .reorder_phrases("g1", &["p2".into(), "p1".into()])
        .unwrap();
    let duplicated = service.duplicate_phrase("p2", "copy").unwrap();
    assert_eq!(duplicated.value.title, "P2");
    service.delete_phrase("copy").unwrap();
    service.delete_game("b").unwrap();

    let snapshot = service.get_library().unwrap();
    assert_eq!(snapshot.games[0].id, "a");
    assert_eq!(snapshot.groups[0].id, "g2");
    assert_eq!(snapshot.phrases[0].id, "p2");
}

#[test]
fn variable_definition_order_is_part_of_the_complete_library_reorder_contract() {
    let now = Arc::new(AtomicU64::new(6_000));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Game");
    for (id, name, sort_order) in [("v1", "One", 0), ("v2", "Two", 1)] {
        VariableService::save_definition(
            service.repository_mut(),
            SaveVariableDefinition {
                id: id.into(),
                game_id: "game".into(),
                name: name.into(),
                sort_order,
                rename_confirmed: false,
                presets: vec![],
            },
        )
        .unwrap();
    }

    service
        .reorder_variable_definitions("game", &["v2".into(), "v1".into()])
        .unwrap();
    assert_eq!(
        service
            .get_library()
            .unwrap()
            .variable_definitions
            .iter()
            .map(|definition| (definition.id.as_str(), definition.sort_order))
            .collect::<Vec<_>>(),
        vec![("v2", 0), ("v1", 1)]
    );
}
