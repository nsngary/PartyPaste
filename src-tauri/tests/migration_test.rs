use partypaste_lib::db::models::{
    GameRecord, GroupRecord, OverlayDisplayMode, PhraseRecord, PhraseVariableRefRecord,
    SettingRecord, VariableDefinitionRecord, VariablePresetRecord,
};
use partypaste_lib::db::{Repository, RepositoryError};

fn game(id: &str, sort_order: i64) -> GameRecord {
    GameRecord {
        id: id.into(),
        name: format!("Game {id}"),
        sort_order,
        overlay_display_mode: OverlayDisplayMode::Title,
    }
}

#[test]
fn initial_migration_creates_every_store_and_enforces_foreign_keys() {
    let mut repository = Repository::in_memory().expect("open in-memory repository");

    repository
        .transaction(|tx| {
            tx.insert_game(&game("game-1", 0))?;
            tx.insert_group(&GroupRecord {
                id: "group-1".into(),
                game_id: "game-1".into(),
                name: "General".into(),
                collapsed: false,
                sort_order: 0,
            })?;
            tx.insert_phrase(&PhraseRecord {
                id: "phrase-1".into(),
                group_id: "group-1".into(),
                title: "Greeting".into(),
                body_template: "Hello {name}".into(),
                favorite: true,
                favorite_order: Some(0),
                hotkey: Some("Ctrl+1".into()),
                sort_order: 0,
            })?;
            tx.insert_variable_definition(&VariableDefinitionRecord {
                id: "variable-1".into(),
                game_id: "game-1".into(),
                name: "name".into(),
                normalized_name: "name".into(),
                sort_order: 0,
            })?;
            tx.insert_variable_preset(&VariablePresetRecord {
                id: "preset-1".into(),
                variable_definition_id: "variable-1".into(),
                value: "Ada".into(),
                sort_order: 0,
            })?;
            tx.insert_phrase_variable_ref(&PhraseVariableRefRecord {
                phrase_id: "phrase-1".into(),
                variable_definition_id: "variable-1".into(),
                token_order: 0,
            })?;
            tx.upsert_setting(&SettingRecord {
                key: "language".into(),
                value: "en".into(),
            })?;
            Ok(())
        })
        .expect("all initial tables accept their records");

    let snapshot = repository.snapshot().expect("read complete snapshot");
    assert_eq!(repository.schema_version().unwrap(), 1);
    assert_eq!(repository.applied_migration_versions().unwrap(), vec![1]);
    assert_eq!(snapshot.games.len(), 1);
    assert_eq!(snapshot.groups.len(), 1);
    assert_eq!(snapshot.phrases.len(), 1);
    assert_eq!(snapshot.variable_definitions.len(), 1);
    assert_eq!(snapshot.variable_presets.len(), 1);
    assert_eq!(snapshot.phrase_variable_refs.len(), 1);
    assert_eq!(snapshot.settings.len(), 1);

    let before_orphan = snapshot;
    let orphan_result: Result<(), RepositoryError> = repository.transaction(|tx| {
        tx.insert_group(&GroupRecord {
            id: "orphan".into(),
            game_id: "missing-game".into(),
            name: "Orphan".into(),
            collapsed: false,
            sort_order: 0,
        })
    });
    assert!(
        orphan_result.is_err(),
        "foreign keys must reject orphan rows"
    );
    assert_eq!(repository.snapshot().unwrap(), before_orphan);
}

#[test]
fn initial_migration_creates_unique_indexes_for_names_and_sibling_positions() {
    let mut repository = Repository::in_memory().expect("open in-memory repository");
    repository
        .transaction(|tx| {
            tx.insert_game(&game("game-1", 0))?;
            tx.insert_group(&GroupRecord {
                id: "group-1".into(),
                game_id: "game-1".into(),
                name: "General".into(),
                collapsed: false,
                sort_order: 0,
            })?;
            tx.insert_phrase(&PhraseRecord {
                id: "phrase-1".into(),
                group_id: "group-1".into(),
                title: "Greeting".into(),
                body_template: "Hello".into(),
                favorite: false,
                favorite_order: None,
                hotkey: None,
                sort_order: 0,
            })?;
            tx.insert_variable_definition(&VariableDefinitionRecord {
                id: "variable-1".into(),
                game_id: "game-1".into(),
                name: "Player".into(),
                normalized_name: "player".into(),
                sort_order: 0,
            })?;
            tx.insert_variable_preset(&VariablePresetRecord {
                id: "preset-1".into(),
                variable_definition_id: "variable-1".into(),
                value: "Ada".into(),
                sort_order: 0,
            })?;
            Ok(())
        })
        .unwrap();

    let duplicate_game_order: Result<(), RepositoryError> =
        repository.transaction(|tx| tx.insert_game(&game("game-2", 0)));
    assert!(duplicate_game_order.is_err());

    let duplicate_group_order: Result<(), RepositoryError> = repository.transaction(|tx| {
        tx.insert_group(&GroupRecord {
            id: "group-2".into(),
            game_id: "game-1".into(),
            name: "Second".into(),
            collapsed: false,
            sort_order: 0,
        })
    });
    assert!(duplicate_group_order.is_err());

    let duplicate_phrase_order: Result<(), RepositoryError> = repository.transaction(|tx| {
        tx.insert_phrase(&PhraseRecord {
            id: "phrase-2".into(),
            group_id: "group-1".into(),
            title: "Second".into(),
            body_template: "World".into(),
            favorite: false,
            favorite_order: None,
            hotkey: None,
            sort_order: 0,
        })
    });
    assert!(duplicate_phrase_order.is_err());

    let duplicate_name: Result<(), RepositoryError> = repository.transaction(|tx| {
        tx.insert_variable_definition(&VariableDefinitionRecord {
            id: "variable-2".into(),
            game_id: "game-1".into(),
            name: "PLAYER".into(),
            normalized_name: "player".into(),
            sort_order: 1,
        })
    });
    assert!(duplicate_name.is_err());

    let duplicate_order: Result<(), RepositoryError> = repository.transaction(|tx| {
        tx.insert_variable_definition(&VariableDefinitionRecord {
            id: "variable-3".into(),
            game_id: "game-1".into(),
            name: "Location".into(),
            normalized_name: "location".into(),
            sort_order: 0,
        })
    });
    assert!(duplicate_order.is_err());

    let duplicate_preset_order: Result<(), RepositoryError> = repository.transaction(|tx| {
        tx.insert_variable_preset(&VariablePresetRecord {
            id: "preset-2".into(),
            variable_definition_id: "variable-1".into(),
            value: "Grace".into(),
            sort_order: 0,
        })
    });
    assert!(duplicate_preset_order.is_err());
}
