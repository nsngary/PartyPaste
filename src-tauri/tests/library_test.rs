use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use partypaste_lib::db::Repository;
use partypaste_lib::db::models::OverlayDisplayMode;
use partypaste_lib::services::library::{
    CreateGameInput, CreateGroupInput, CreatePhraseInput, LibraryService, LibraryServiceError,
    SaveVariableDefinition, SaveVariablePreset, UpdateGameInput, UpdateGroupInput,
    UpdatePhraseInput,
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
fn game_display_mode_updates_without_renaming_the_game() {
    let now = Arc::new(AtomicU64::new(1_000));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Guild Wars");

    let updated = service
        .set_overlay_display_mode("game", OverlayDisplayMode::Full)
        .unwrap();

    assert_eq!(updated.name, "Guild Wars");
    assert_eq!(updated.overlay_display_mode, OverlayDisplayMode::Full);
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
    create_phrase(&mut service, "dotless", "group", "Kısa", "x", None);
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
    assert_eq!(
        service.search_phrases("game", "kısa").unwrap()[0].id,
        "dotless"
    );
    assert!(service.search_phrases("game", "KISA").unwrap().is_empty());
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
    service
        .save_variable_definition(SaveVariableDefinition {
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
        })
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
    assert!(deleted.value.groups.iter().all(|group| group.id != "a"));
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
    let second = service
        .create_game(CreateGameInput {
            id: "b".into(),
            name: "B".into(),
        })
        .unwrap();

    service.undo_operation(&first.undo.operation_id).unwrap();
    assert_eq!(
        service
            .get_library()
            .unwrap()
            .games
            .iter()
            .map(|game| (game.id.as_str(), game.sort_order))
            .collect::<Vec<_>>(),
        vec![("b", 0)]
    );
    service.undo_operation(&second.undo.operation_id).unwrap();
    assert!(service.get_library().unwrap().games.is_empty());
}

#[test]
fn conflicted_undo_keeps_the_receipt_available_until_dependency_is_undone() {
    let now = Arc::new(AtomicU64::new(8_000));
    let mut service = service_at(now);
    let created = service
        .create_game(CreateGameInput {
            id: "a".into(),
            name: "A".into(),
        })
        .unwrap();
    let updated = service
        .update_game(UpdateGameInput {
            id: "a".into(),
            name: "Changed".into(),
        })
        .unwrap();

    assert!(matches!(
        service.undo_operation(&created.undo.operation_id),
        Err(LibraryServiceError::UndoConflict)
    ));
    service.undo_operation(&updated.undo.operation_id).unwrap();
    service.undo_operation(&created.undo.operation_id).unwrap();
    assert!(service.get_library().unwrap().games.is_empty());
}

#[test]
fn phrase_update_body_conflict_is_atomic_and_keeps_the_receipt_for_retry() {
    let now = Arc::new(AtomicU64::new(8_250));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Game");
    create_group(&mut service, "group", "game", "Group");
    create_phrase(&mut service, "phrase", "group", "Original", "Body A", None);
    let first = service
        .update_phrase(UpdatePhraseInput {
            id: "phrase".into(),
            title: "First".into(),
            body_template: "Body B".into(),
            hotkey: Some("Ctrl+B".into()),
        })
        .unwrap();
    let second = service
        .update_phrase(UpdatePhraseInput {
            id: "phrase".into(),
            title: "First".into(),
            body_template: "Body C".into(),
            hotkey: Some("Ctrl+B".into()),
        })
        .unwrap();
    let before_failed_undo = service.get_library().unwrap();

    assert!(matches!(
        service.undo_operation(&first.undo.operation_id),
        Err(LibraryServiceError::UndoConflict)
    ));
    assert_eq!(service.get_library().unwrap(), before_failed_undo);

    service.undo_operation(&second.undo.operation_id).unwrap();
    let restored = service.undo_operation(&first.undo.operation_id).unwrap();
    let phrase = &restored.phrases[0];
    assert_eq!(phrase.title, "Original");
    assert_eq!(phrase.body_template, "Body A");
    assert_eq!(phrase.hotkey, None);
}

#[test]
fn undo_deleted_records_restores_their_anchor_without_moving_later_creations() {
    let now = Arc::new(AtomicU64::new(8_500));
    let mut service = service_at(now);
    for id in ["a", "b", "z"] {
        create_game(&mut service, id, id);
    }
    let deleted_game = service.delete_game("b").unwrap();
    create_game(&mut service, "c", "c");
    service
        .reorder_games(&["a".into(), "c".into(), "z".into()])
        .unwrap();
    let snapshot = service
        .undo_operation(&deleted_game.undo.operation_id)
        .unwrap();
    assert_eq!(
        snapshot
            .games
            .iter()
            .map(|game| (game.id.as_str(), game.sort_order))
            .collect::<Vec<_>>(),
        vec![("a", 0), ("c", 1), ("b", 2), ("z", 3)]
    );

    for id in ["ga", "gb", "gz"] {
        create_group(&mut service, id, "a", id);
    }
    create_phrase(&mut service, "restored-child", "gb", "child", "body", None);
    let deleted_group = service.delete_group("gb").unwrap();
    create_group(&mut service, "gc", "a", "gc");
    service
        .reorder_groups("a", &["ga".into(), "gc".into(), "gz".into()])
        .unwrap();
    let snapshot = service
        .undo_operation(&deleted_group.undo.operation_id)
        .unwrap();
    assert_eq!(
        snapshot
            .groups
            .iter()
            .filter(|group| group.game_id == "a")
            .map(|group| (group.id.as_str(), group.sort_order))
            .collect::<Vec<_>>(),
        vec![("ga", 0), ("gc", 1), ("gb", 2), ("gz", 3)]
    );
    assert!(
        snapshot
            .phrases
            .iter()
            .any(|phrase| phrase.id == "restored-child" && phrase.group_id == "gb")
    );

    for id in ["pa", "pb", "pz"] {
        create_phrase(&mut service, id, "ga", id, "body", None);
    }
    let deleted_phrase = service.delete_phrase("pb").unwrap();
    service.duplicate_phrase("pa", "pc").unwrap();
    let snapshot = service
        .undo_operation(&deleted_phrase.undo.operation_id)
        .unwrap();
    assert_eq!(
        snapshot
            .phrases
            .iter()
            .filter(|phrase| phrase.group_id == "ga")
            .map(|phrase| (phrase.id.as_str(), phrase.sort_order))
            .collect::<Vec<_>>(),
        vec![("pa", 0), ("pc", 1), ("pb", 2), ("pz", 3)]
    );
}

#[test]
fn undo_deleted_favorite_preserves_a_later_favorite_and_contiguous_order() {
    let now = Arc::new(AtomicU64::new(8_750));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Game");
    create_group(&mut service, "group", "game", "Group");
    for id in ["a", "b", "z", "c"] {
        create_phrase(&mut service, id, "group", id, "body", None);
    }
    for id in ["a", "b", "z"] {
        service.set_favorite(id, true).unwrap();
    }
    let deleted = service.delete_phrase("b").unwrap();
    service.set_favorite("c", true).unwrap();
    service
        .reorder_favorites("game", &["a".into(), "c".into(), "z".into()])
        .unwrap();

    let snapshot = service.undo_operation(&deleted.undo.operation_id).unwrap();
    let mut favorites = snapshot
        .phrases
        .iter()
        .filter(|phrase| phrase.favorite)
        .map(|phrase| (phrase.id.as_str(), phrase.favorite_order))
        .collect::<Vec<_>>();
    favorites.sort_by_key(|(_, order)| *order);
    assert_eq!(
        favorites,
        vec![
            ("a", Some(0)),
            ("c", Some(1)),
            ("b", Some(2)),
            ("z", Some(3))
        ]
    );
}

#[test]
fn undo_favorite_membership_restores_nullable_order_consistently() {
    let now = Arc::new(AtomicU64::new(8_775));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Game");
    create_group(&mut service, "group", "game", "Group");
    create_phrase(&mut service, "phrase", "group", "Phrase", "body", None);

    let favorited = service.set_favorite("phrase", true).unwrap();
    let snapshot = service
        .undo_operation(&favorited.undo.operation_id)
        .unwrap();
    let phrase = &snapshot.phrases[0];
    assert!(!phrase.favorite);
    assert_eq!(phrase.favorite_order, None);

    let favorited_again = service.set_favorite("phrase", true).unwrap();
    let unfavorited = service.set_favorite("phrase", false).unwrap();
    let snapshot = service
        .undo_operation(&unfavorited.undo.operation_id)
        .unwrap();
    let phrase = &snapshot.phrases[0];
    assert!(phrase.favorite);
    assert_eq!(phrase.favorite_order, Some(0));
    service
        .undo_operation(&favorited_again.undo.operation_id)
        .unwrap();
}

#[test]
fn undo_variable_delete_reports_normalized_name_collision_and_retains_receipt() {
    let now = Arc::new(AtomicU64::new(8_800));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Game");
    service
        .save_variable_definition(SaveVariableDefinition {
            id: "deleted".into(),
            game_id: "game".into(),
            name: "Ｓｔｒａße".into(),
            sort_order: 0,
            rename_confirmed: false,
            presets: vec![],
        })
        .unwrap();
    let deleted = service.delete_variable_definition("deleted").unwrap();
    let colliding = service
        .save_variable_definition(SaveVariableDefinition {
            id: "collision".into(),
            game_id: "game".into(),
            name: "STRASSE".into(),
            sort_order: 0,
            rename_confirmed: false,
            presets: vec![],
        })
        .unwrap();
    let collision_operation = colliding.undo_receipt().unwrap().operation_id.clone();

    for _ in 0..2 {
        assert!(matches!(
            service.undo_operation(&deleted.undo.operation_id),
            Err(LibraryServiceError::UndoConflict)
        ));
        assert_eq!(
            service
                .get_library()
                .unwrap()
                .variable_definitions
                .iter()
                .map(|definition| definition.id.as_str())
                .collect::<Vec<_>>(),
            vec!["collision"]
        );
    }

    service.undo_operation(&collision_operation).unwrap();
    let restored = service.undo_operation(&deleted.undo.operation_id).unwrap();
    assert_eq!(restored.variable_definitions[0].id, "deleted");
}

#[test]
fn undo_variable_delete_rebuilds_refs_from_the_later_phrase_body() {
    let now = Arc::new(AtomicU64::new(8_825));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Game");
    create_group(&mut service, "group", "game", "Group");
    service
        .save_variable_definition(SaveVariableDefinition {
            id: "count".into(),
            game_id: "game".into(),
            name: "Count".into(),
            sort_order: 0,
            rename_confirmed: false,
            presets: vec![],
        })
        .unwrap();
    create_phrase(
        &mut service,
        "phrase",
        "group",
        "Phrase",
        "Need {Count}",
        None,
    );
    assert_eq!(service.get_library().unwrap().phrase_variable_refs.len(), 1);

    let deleted = service.delete_variable_definition("count").unwrap();
    service
        .update_phrase(UpdatePhraseInput {
            id: "phrase".into(),
            title: "Phrase".into(),
            body_template: "Keep {Unknown} as free text".into(),
            hotkey: None,
        })
        .unwrap();
    let restored = service.undo_operation(&deleted.undo.operation_id).unwrap();

    assert_eq!(
        restored.phrases[0].body_template,
        "Keep {Unknown} as free text"
    );
    assert!(restored.phrase_variable_refs.is_empty());
}

#[test]
fn undo_variable_rename_preserves_later_body_and_rebuilds_known_and_unknown_refs() {
    let now = Arc::new(AtomicU64::new(8_850));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Game");
    create_group(&mut service, "group", "game", "Group");
    service
        .save_variable_definition(SaveVariableDefinition {
            id: "count".into(),
            game_id: "game".into(),
            name: "Count".into(),
            sort_order: 0,
            rename_confirmed: false,
            presets: vec![],
        })
        .unwrap();
    create_phrase(
        &mut service,
        "phrase",
        "group",
        "Phrase",
        "Need {Count}",
        None,
    );
    let renamed = service
        .save_variable_definition(SaveVariableDefinition {
            id: "count".into(),
            game_id: "game".into(),
            name: "Players".into(),
            sort_order: 0,
            rename_confirmed: true,
            presets: vec![],
        })
        .unwrap();
    let rename_operation = renamed.undo_receipt().unwrap().operation_id.clone();
    service
        .update_phrase(UpdatePhraseInput {
            id: "phrase".into(),
            title: "Phrase".into(),
            body_template: "Again {Count}; keep {Unknown}".into(),
            hotkey: None,
        })
        .unwrap();

    let restored = service.undo_operation(&rename_operation).unwrap();
    assert_eq!(restored.variable_definitions[0].name, "Count");
    assert_eq!(
        restored.phrases[0].body_template,
        "Again {Count}; keep {Unknown}"
    );
    assert_eq!(restored.phrase_variable_refs.len(), 1);
    assert_eq!(
        restored.phrase_variable_refs[0].variable_definition_id,
        "count"
    );
    assert_eq!(restored.phrase_variable_refs[0].token_order, 0);
}

#[test]
fn phrase_mutations_return_the_reference_set_in_the_complete_snapshot() {
    let now = Arc::new(AtomicU64::new(8_900));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Game");
    create_group(&mut service, "group", "game", "Group");
    service
        .save_variable_definition(SaveVariableDefinition {
            id: "count".into(),
            game_id: "game".into(),
            name: "Count".into(),
            sort_order: 0,
            rename_confirmed: false,
            presets: vec![],
        })
        .unwrap();

    let created = service
        .create_phrase(CreatePhraseInput {
            id: "phrase".into(),
            group_id: "group".into(),
            title: "Phrase".into(),
            body_template: "Need {Count}".into(),
            hotkey: None,
        })
        .unwrap();
    assert_eq!(created.value.phrase_variable_refs.len(), 1);
    assert_eq!(created.value.phrase_variable_refs[0].phrase_id, "phrase");

    let updated = service
        .update_phrase(UpdatePhraseInput {
            id: "phrase".into(),
            title: "Phrase".into(),
            body_template: "No variable".into(),
            hotkey: None,
        })
        .unwrap();
    assert!(updated.value.phrase_variable_refs.is_empty());
}

#[test]
fn undo_deleted_variable_definition_restores_definition_and_presets_at_their_anchors() {
    let now = Arc::new(AtomicU64::new(8_950));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Game");
    for (id, name, presets) in [
        ("a", "A", vec![("a1", "1"), ("a2", "2")]),
        ("b", "B", vec![("b1", "1"), ("b2", "2")]),
        ("z", "Z", vec![("z1", "1"), ("z2", "2")]),
    ] {
        service
            .save_variable_definition(SaveVariableDefinition {
                id: id.into(),
                game_id: "game".into(),
                name: name.into(),
                sort_order: service.list_variable_definitions("game").unwrap().len() as i64,
                rename_confirmed: false,
                presets: presets
                    .into_iter()
                    .enumerate()
                    .map(|(sort_order, (id, value))| SaveVariablePreset {
                        id: id.into(),
                        value: value.into(),
                        sort_order: sort_order as i64,
                    })
                    .collect(),
            })
            .unwrap();
    }

    let removed_preset = service
        .save_variable_definition(SaveVariableDefinition {
            id: "b".into(),
            game_id: "game".into(),
            name: "B".into(),
            sort_order: 1,
            rename_confirmed: false,
            presets: vec![SaveVariablePreset {
                id: "b1".into(),
                value: "1".into(),
                sort_order: 0,
            }],
        })
        .unwrap();
    let removed_preset_operation = removed_preset.undo_receipt().unwrap().operation_id.clone();
    service
        .save_variable_definition(SaveVariableDefinition {
            id: "b".into(),
            game_id: "game".into(),
            name: "B".into(),
            sort_order: 1,
            rename_confirmed: false,
            presets: vec![
                SaveVariablePreset {
                    id: "b1".into(),
                    value: "1".into(),
                    sort_order: 0,
                },
                SaveVariablePreset {
                    id: "b3".into(),
                    value: "3".into(),
                    sort_order: 1,
                },
            ],
        })
        .unwrap();
    let snapshot = service.undo_operation(&removed_preset_operation).unwrap();
    assert_eq!(
        snapshot
            .variable_presets
            .iter()
            .filter(|preset| preset.variable_definition_id == "b")
            .map(|preset| (preset.id.as_str(), preset.sort_order))
            .collect::<Vec<_>>(),
        vec![("b1", 0), ("b2", 1), ("b3", 2)]
    );

    let deleted = service.delete_variable_definition("b").unwrap();
    service
        .save_variable_definition(SaveVariableDefinition {
            id: "c".into(),
            game_id: "game".into(),
            name: "C".into(),
            sort_order: 2,
            rename_confirmed: false,
            presets: vec![SaveVariablePreset {
                id: "c1".into(),
                value: "1".into(),
                sort_order: 0,
            }],
        })
        .unwrap();

    let snapshot = service.undo_operation(&deleted.undo.operation_id).unwrap();
    assert_eq!(
        snapshot
            .variable_definitions
            .iter()
            .map(|definition| (definition.id.as_str(), definition.sort_order))
            .collect::<Vec<_>>(),
        vec![("a", 0), ("b", 1), ("z", 2), ("c", 3)]
    );
    assert_eq!(
        snapshot
            .variable_presets
            .iter()
            .filter(|preset| preset.variable_definition_id == "b")
            .map(|preset| (preset.id.as_str(), preset.sort_order))
            .collect::<Vec<_>>(),
        vec![("b1", 0), ("b2", 1), ("b3", 2)]
    );
    assert!(snapshot.variable_presets.iter().any(|preset| {
        preset.id == "c1" && preset.variable_definition_id == "c" && preset.sort_order == 0
    }));
}

#[test]
fn deleting_a_group_reindexes_surviving_favorites_without_changing_group_order() {
    let now = Arc::new(AtomicU64::new(9_000));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Game");
    create_group(&mut service, "a", "game", "A");
    create_group(&mut service, "b", "game", "B");
    create_phrase(&mut service, "p1", "a", "P1", "P1", None);
    create_phrase(&mut service, "p2", "b", "P2", "P2", None);
    create_phrase(&mut service, "p3", "b", "P3", "P3", None);
    for id in ["p1", "p2", "p3"] {
        service.set_favorite(id, true).unwrap();
    }
    service
        .reorder_favorites("game", &["p2".into(), "p1".into(), "p3".into()])
        .unwrap();

    let deleted = service.delete_group("a").unwrap();
    assert_eq!(
        deleted
            .value
            .phrases
            .iter()
            .filter(|phrase| phrase.favorite)
            .map(|phrase| (phrase.id.as_str(), phrase.favorite_order))
            .collect::<Vec<_>>(),
        vec![("p2", Some(0)), ("p3", Some(1))]
    );
    assert_eq!(
        deleted
            .value
            .groups
            .iter()
            .map(|group| (group.id.as_str(), group.sort_order))
            .collect::<Vec<_>>(),
        vec![("b", 0)]
    );
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
    assert_eq!(
        duplicated
            .value
            .phrases
            .iter()
            .find(|phrase| phrase.id == "copy")
            .unwrap()
            .title,
        "P2"
    );
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
        service
            .save_variable_definition(SaveVariableDefinition {
                id: id.into(),
                game_id: "game".into(),
                name: name.into(),
                sort_order,
                rename_confirmed: false,
                presets: vec![],
            })
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

#[test]
fn variable_mutations_have_typed_undo_and_preserve_rename_preview_atomicity() {
    let now = Arc::new(AtomicU64::new(10_000));
    let mut service = service_at(now);
    create_game(&mut service, "game", "Game");
    let saved = service
        .save_variable_definition(SaveVariableDefinition {
            id: "v".into(),
            game_id: "game".into(),
            name: "Count".into(),
            sort_order: 0,
            rename_confirmed: false,
            presets: vec![
                SaveVariablePreset {
                    id: "p1".into(),
                    value: "1".into(),
                    sort_order: 0,
                },
                SaveVariablePreset {
                    id: "p2".into(),
                    value: "2".into(),
                    sort_order: 1,
                },
            ],
        })
        .unwrap();
    let saved_receipt = saved.undo_receipt().unwrap();
    service.undo_operation(&saved_receipt.operation_id).unwrap();
    assert!(
        service
            .list_variable_definitions("game")
            .unwrap()
            .is_empty()
    );

    service
        .save_variable_definition(SaveVariableDefinition {
            id: "v".into(),
            game_id: "game".into(),
            name: "Count".into(),
            sort_order: 0,
            rename_confirmed: false,
            presets: vec![
                SaveVariablePreset {
                    id: "p1".into(),
                    value: "1".into(),
                    sort_order: 0,
                },
                SaveVariablePreset {
                    id: "p2".into(),
                    value: "2".into(),
                    sort_order: 1,
                },
            ],
        })
        .unwrap();
    let reordered = service
        .reorder_variable_presets("v", &["p2".into(), "p1".into()])
        .unwrap();
    assert_eq!(
        reordered
            .value
            .variable_presets
            .iter()
            .map(|preset| preset.id.as_str())
            .collect::<Vec<_>>(),
        vec!["p2", "p1"]
    );
    service
        .undo_operation(&reordered.undo.operation_id)
        .unwrap();

    let preview = service
        .save_variable_definition(SaveVariableDefinition {
            id: "v".into(),
            game_id: "game".into(),
            name: "Players".into(),
            sort_order: 0,
            rename_confirmed: false,
            presets: vec![],
        })
        .unwrap();
    assert!(preview.undo_receipt().is_none());
    assert_eq!(
        service.list_variable_definitions("game").unwrap()[0]
            .definition
            .name,
        "Count"
    );

    let deleted = service.delete_variable_definition("v").unwrap();
    assert!(deleted.value.variable_definitions.is_empty());
    service.undo_operation(&deleted.undo.operation_id).unwrap();
    assert_eq!(service.list_variable_definitions("game").unwrap().len(), 1);
}
