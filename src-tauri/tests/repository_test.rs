use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use partypaste_lib::db::models::{GameRecord, GroupRecord, OverlayDisplayMode, PhraseRecord};
use partypaste_lib::db::{Repository, RepositoryError};
use partypaste_lib::paths::DataPaths;

fn game(id: &str, sort_order: i64) -> GameRecord {
    GameRecord {
        id: id.into(),
        name: format!("Game {id}"),
        sort_order,
        overlay_display_mode: OverlayDisplayMode::Title,
    }
}

fn group(id: &str, game_id: &str, sort_order: i64) -> GroupRecord {
    GroupRecord {
        id: id.into(),
        game_id: game_id.into(),
        name: format!("Group {id}"),
        collapsed: false,
        sort_order,
    }
}

fn phrase(id: &str, group_id: &str, sort_order: i64) -> PhraseRecord {
    PhraseRecord {
        id: id.into(),
        group_id: group_id.into(),
        title: format!("Phrase {id}"),
        body_template: format!("Body {id}"),
        favorite: false,
        favorite_order: None,
        hotkey: None,
        sort_order,
    }
}

#[test]
fn reorder_phrases_reindexes_the_complete_sibling_set() {
    let mut repository = Repository::in_memory().unwrap();
    repository
        .transaction(|tx| {
            tx.insert_game(&game("game-1", 0))?;
            tx.insert_group(&group("group-1", "game-1", 0))?;
            tx.insert_phrase(&phrase("phrase-a", "group-1", 0))?;
            tx.insert_phrase(&phrase("phrase-b", "group-1", 1))?;
            tx.insert_phrase(&phrase("phrase-c", "group-1", 2))?;
            Ok(())
        })
        .unwrap();

    repository
        .transaction(|tx| {
            tx.reorder_phrases(
                "group-1",
                &["phrase-c".into(), "phrase-a".into(), "phrase-b".into()],
            )
        })
        .unwrap();

    let phrases = repository.snapshot().unwrap().phrases;
    assert_eq!(
        phrases
            .iter()
            .map(|phrase| (phrase.id.as_str(), phrase.sort_order))
            .collect::<Vec<_>>(),
        vec![("phrase-c", 0), ("phrase-a", 1), ("phrase-b", 2)]
    );
}

#[test]
fn incomplete_reorder_rolls_back_without_changing_the_snapshot() {
    let mut repository = Repository::in_memory().unwrap();
    repository
        .transaction(|tx| {
            tx.insert_game(&game("game-1", 0))?;
            tx.insert_group(&group("group-1", "game-1", 0))?;
            tx.insert_phrase(&phrase("phrase-a", "group-1", 0))?;
            tx.insert_phrase(&phrase("phrase-b", "group-1", 1))?;
            Ok(())
        })
        .unwrap();
    let before = repository.snapshot().unwrap();

    let result: Result<(), RepositoryError> =
        repository.transaction(|tx| tx.reorder_phrases("group-1", &["phrase-b".into()]));

    assert!(result.is_err());
    assert_eq!(repository.snapshot().unwrap(), before);
}

#[test]
fn deleting_a_parent_with_children_requires_explicit_service_action() {
    let mut repository = Repository::in_memory().unwrap();
    repository
        .transaction(|tx| {
            tx.insert_game(&game("game-1", 0))?;
            tx.insert_group(&group("group-1", "game-1", 0))?;
            Ok(())
        })
        .unwrap();
    let before = repository.snapshot().unwrap();

    let result: Result<(), RepositoryError> = repository.transaction(|tx| tx.delete_game("game-1"));

    assert!(result.is_err());
    assert_eq!(repository.snapshot().unwrap(), before);
}

#[test]
fn failed_multi_record_operation_leaves_the_pre_transaction_snapshot_unchanged() {
    let mut repository = Repository::in_memory().unwrap();
    repository
        .transaction(|tx| tx.insert_game(&game("existing", 0)))
        .unwrap();
    let before = repository.snapshot().unwrap();

    let result: Result<(), RepositoryError> = repository.transaction(|tx| {
        tx.insert_game(&game("new-game", 1))?;
        tx.insert_group(&group("bad-group", "missing-game", 0))?;
        Ok(())
    });

    assert!(result.is_err());
    assert_eq!(repository.snapshot().unwrap(), before);
}

#[test]
fn open_creates_the_database_parent_and_persists_committed_records() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("partypaste-repository-{unique}"));
    let paths = DataPaths {
        database: root.join("nested/partypaste.db"),
        backups: root.join("backups"),
        logs: root.join("logs"),
        portable: false,
    };

    {
        let mut repository = Repository::open(paths.clone()).unwrap();
        repository
            .transaction(|tx| tx.insert_game(&game("persistent", 0)))
            .unwrap();
    }

    {
        let repository = Repository::open(paths).unwrap();
        assert_eq!(
            repository.snapshot().unwrap().games,
            vec![game("persistent", 0)]
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn one_hundred_mixed_phrase_moves_preserve_contiguous_unique_sibling_positions() {
    let mut repository = Repository::in_memory().unwrap();
    repository
        .transaction(|tx| {
            tx.insert_game(&game("game-1", 0))?;
            tx.insert_group(&group("group-a", "game-1", 0))?;
            tx.insert_group(&group("group-b", "game-1", 1))?;
            for index in 0..11 {
                tx.insert_phrase(&phrase(&format!("phrase-{index}"), "group-a", index))?;
            }
            Ok(())
        })
        .unwrap();

    for move_index in 0..100 {
        let snapshot = repository.snapshot().unwrap();
        let phrase_id = format!("phrase-{}", move_index % 11);
        let current = snapshot
            .phrases
            .iter()
            .find(|phrase| phrase.id == phrase_id)
            .unwrap();
        let target_group = if current.group_id == "group-a" {
            "group-b"
        } else {
            "group-a"
        };
        let target_len = snapshot
            .phrases
            .iter()
            .filter(|phrase| phrase.group_id == target_group)
            .count();
        repository
            .transaction(|tx| {
                tx.move_phrase(&phrase_id, target_group, move_index % (target_len + 1))
            })
            .unwrap();

        let snapshot = repository.snapshot().unwrap();
        for group_id in ["group-a", "group-b"] {
            let positions = snapshot
                .phrases
                .iter()
                .filter(|phrase| phrase.group_id == group_id)
                .map(|phrase| phrase.sort_order)
                .collect::<Vec<_>>();
            assert_eq!(positions, (0..positions.len() as i64).collect::<Vec<_>>());
        }
    }
}
