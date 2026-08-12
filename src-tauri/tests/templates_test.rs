use partypaste_lib::db::Repository;
use partypaste_lib::db::models::{
    GameRecord, GroupRecord, OverlayDisplayMode, PhraseRecord, PhraseVariableRefRecord,
    VariableDefinitionRecord, VariablePresetRecord,
};
use partypaste_lib::services::library::{
    SaveVariableDefinition, SaveVariablePreset, SaveVariableResult, VariableService,
    VariableServiceError,
};
use partypaste_lib::services::templates::{TemplateIssueCode, TemplateService, TemplateToken};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplateFixtures {
    valid: Vec<ValidFixture>,
    invalid: Vec<InvalidFixture>,
    resolution: Vec<ResolutionFixture>,
    rename: RenameFixture,
    atomic_rename: AtomicRenameFixture,
    delete_fallback: DeleteFallbackFixture,
}

#[derive(Debug, Deserialize)]
struct ResolutionFixture {
    name: String,
    source: String,
    values: std::collections::HashMap<String, String>,
    value: Option<String>,
    issues: Option<Vec<partypaste_lib::services::templates::TemplateIssue>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameFixture {
    old_name: String,
    new_name: String,
    existing_names: Vec<String>,
    phrases: Vec<RenamePhraseFixture>,
    affected_phrase_count: usize,
    affected_token_count: usize,
    expected_reference_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenamePhraseFixture {
    id: String,
    source: String,
    renamed_source: String,
    renamed_token_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtomicRenameFixture {
    old_name: String,
    new_name: String,
    existing_names: Vec<String>,
    expected_error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteFallbackFixture {
    name: String,
    affected_phrase_count: usize,
    free_text_values: std::collections::HashMap<String, String>,
    phrases: Vec<DeletePhraseFixture>,
}

#[derive(Debug, Deserialize)]
struct DeletePhraseFixture {
    id: String,
    source: String,
    resolved: String,
}

#[derive(Debug, Deserialize)]
struct ValidFixture {
    name: String,
    source: String,
    tokens: Vec<TemplateToken>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvalidFixture {
    name: String,
    source: String,
    issue_codes: Vec<TemplateIssueCode>,
}

fn fixtures() -> TemplateFixtures {
    serde_json::from_str(include_str!("../../src/domain/template.fixtures.json")).unwrap()
}

fn game(id: &str) -> GameRecord {
    GameRecord {
        id: id.into(),
        name: format!("Game {id}"),
        sort_order: 0,
        overlay_display_mode: OverlayDisplayMode::Title,
    }
}

fn group(id: &str, game_id: &str) -> GroupRecord {
    GroupRecord {
        id: id.into(),
        game_id: game_id.into(),
        name: format!("Group {id}"),
        collapsed: false,
        sort_order: 0,
    }
}

fn phrase(id: &str, group_id: &str, body_template: &str, sort_order: i64) -> PhraseRecord {
    PhraseRecord {
        id: id.into(),
        group_id: group_id.into(),
        title: format!("Phrase {id}"),
        body_template: body_template.into(),
        favorite: false,
        favorite_order: None,
        hotkey: None,
        sort_order,
    }
}

fn definition(id: &str, game_id: &str, name: &str, sort_order: i64) -> VariableDefinitionRecord {
    VariableDefinitionRecord {
        id: id.into(),
        game_id: game_id.into(),
        name: name.into(),
        normalized_name: name.into(),
        sort_order,
    }
}

fn seeded_repository() -> Repository {
    let fixtures = fixtures();
    let rename = fixtures.rename;
    let other_name = rename
        .existing_names
        .iter()
        .find(|name| *name != &rename.old_name)
        .unwrap();
    let mut repository = Repository::in_memory().unwrap();
    repository
        .transaction(|tx| {
            tx.insert_game(&game("game-1"))?;
            let mut second_game = game("game-2");
            second_game.sort_order = 1;
            tx.insert_game(&second_game)?;
            tx.insert_group(&group("group-1", "game-1"))?;
            tx.insert_group(&group("group-2", "game-2"))?;
            for (sort_order, fixture) in rename.phrases.iter().enumerate() {
                tx.insert_phrase(&phrase(
                    &fixture.id,
                    "group-1",
                    &fixture.source,
                    sort_order as i64,
                ))?;
            }
            tx.insert_phrase(&phrase(
                "phrase-4",
                "group-2",
                &format!("{{{}}}", rename.old_name),
                0,
            ))?;
            tx.insert_variable_definition(&definition(
                "var-people",
                "game-1",
                &rename.old_name,
                0,
            ))?;
            tx.insert_variable_definition(&definition("var-other", "game-1", other_name, 1))?;
            tx.insert_variable_definition(&definition(
                "var-people-2",
                "game-2",
                &rename.old_name,
                0,
            ))?;
            tx.insert_variable_preset(&VariablePresetRecord {
                id: "preset-1".into(),
                variable_definition_id: "var-people".into(),
                value: "4".into(),
                sort_order: 0,
            })?;
            // Deliberately incomplete: rename must refresh stable references
            // from the scanned tokens rather than trust stale rows.
            tx.insert_phrase_variable_ref(&PhraseVariableRefRecord {
                phrase_id: "phrase-1".into(),
                variable_definition_id: "var-people".into(),
                token_order: 0,
            })?;
            Ok(())
        })
        .unwrap();
    repository
}

#[test]
fn templates_resolver_consumes_the_shared_typescript_fixtures() {
    let fixtures = fixtures();

    for fixture in fixtures.resolution {
        let scan = TemplateService::scan(&fixture.source);
        assert!(scan.issues.is_empty(), "{}", fixture.name);
        let result = TemplateService::resolve(&scan.tokens, &fixture.values);
        match (fixture.value, fixture.issues) {
            (Some(value), None) => assert_eq!(result, Ok(value), "{}", fixture.name),
            (None, Some(issues)) => assert_eq!(result, Err(issues), "{}", fixture.name),
            _ => panic!("{} must declare exactly one expected result", fixture.name),
        }
    }
}

#[test]
fn templates_scanner_consumes_the_shared_typescript_fixtures() {
    let fixtures = fixtures();

    for fixture in fixtures.valid {
        let result = TemplateService::scan(&fixture.source);
        assert_eq!(result.issues, [], "{}", fixture.name);
        assert_eq!(result.tokens, fixture.tokens, "{}", fixture.name);
    }
    for fixture in fixtures.invalid {
        let result = TemplateService::scan(&fixture.source);
        assert_eq!(
            result
                .issues
                .iter()
                .map(|issue| issue.code)
                .collect::<Vec<_>>(),
            fixture.issue_codes,
            "{}",
            fixture.name
        );
    }
}

#[test]
fn templates_rename_updates_matching_tokens_and_rebuilds_references_atomically() {
    let fixture = fixtures().rename;
    let mut repository = seeded_repository();

    let impact =
        VariableService::rename_definition(&mut repository, "var-people", &fixture.new_name)
            .unwrap();

    assert_eq!(impact.affected_phrase_count, fixture.affected_phrase_count);
    assert_eq!(impact.affected_token_count, fixture.affected_token_count);
    let snapshot = repository.snapshot().unwrap();
    assert_eq!(snapshot.variable_definitions[0].name, fixture.new_name);
    for phrase_fixture in &fixture.phrases {
        let stored = snapshot
            .phrases
            .iter()
            .find(|phrase| phrase.id == phrase_fixture.id)
            .unwrap();
        assert_eq!(stored.body_template, phrase_fixture.renamed_source);
    }
    assert_eq!(
        snapshot
            .phrases
            .iter()
            .find(|phrase| phrase.id == "phrase-4")
            .unwrap()
            .body_template,
        format!("{{{}}}", fixture.old_name)
    );
    assert_eq!(
        snapshot
            .phrase_variable_refs
            .iter()
            .filter(|reference| reference.variable_definition_id == "var-people")
            .count(),
        fixture.expected_reference_count
    );
    assert_eq!(
        fixture
            .phrases
            .iter()
            .map(|phrase| phrase.renamed_token_count)
            .sum::<usize>(),
        impact.affected_token_count
    );
}

#[test]
fn templates_conflicting_rename_leaves_the_entire_snapshot_unchanged() {
    let fixture = fixtures().atomic_rename;
    let mut repository = seeded_repository();
    let before = repository.snapshot().unwrap();

    assert_eq!(fixture.old_name, fixtures().rename.old_name);
    assert!(fixture.existing_names.contains(&fixture.new_name));
    let error =
        VariableService::rename_definition(&mut repository, "var-people", &fixture.new_name)
            .unwrap_err();
    let error_code = match error {
        VariableServiceError::NameConflict => "name_conflict",
        _ => "unexpected_error",
    };
    assert_eq!(error_code, fixture.expected_error);

    assert_eq!(repository.snapshot().unwrap(), before);
}

#[test]
fn templates_delete_removes_assistance_but_leaves_unknown_tokens_as_free_text() {
    let fixture = fixtures().delete_fallback;
    let mut repository = seeded_repository();

    let impact = VariableService::delete_definition(&mut repository, "var-people").unwrap();

    assert_eq!(impact.affected_phrase_count, fixture.affected_phrase_count);
    let snapshot = repository.snapshot().unwrap();
    assert!(
        snapshot
            .variable_definitions
            .iter()
            .all(|definition| definition.id != "var-people")
    );
    assert!(snapshot.variable_presets.is_empty());
    assert!(snapshot.phrase_variable_refs.is_empty());
    assert!(fixture.free_text_values.contains_key(&fixture.name));
    for phrase_fixture in fixture.phrases {
        let stored = snapshot
            .phrases
            .iter()
            .find(|phrase| phrase.id == phrase_fixture.id)
            .unwrap();
        assert_eq!(stored.body_template, phrase_fixture.source);
        let scan = TemplateService::scan(&stored.body_template);
        assert!(scan.issues.is_empty());
        assert_eq!(
            TemplateService::resolve(&scan.tokens, &fixture.free_text_values),
            Ok(phrase_fixture.resolved)
        );
    }
}

#[test]
fn templates_save_lists_presets_and_reorder_is_complete_and_atomic() {
    let mut repository = seeded_repository();

    let saved = VariableService::save_definition(
        &mut repository,
        SaveVariableDefinition {
            id: "var-location".into(),
            game_id: "game-1".into(),
            name: "地點".into(),
            sort_order: 2,
            rename_confirmed: false,
            presets: vec![
                SaveVariablePreset {
                    id: "preset-north".into(),
                    value: "北門".into(),
                    sort_order: 0,
                },
                SaveVariablePreset {
                    id: "preset-south".into(),
                    value: "南門".into(),
                    sort_order: 1,
                },
            ],
        },
    )
    .unwrap();

    let SaveVariableResult::Saved {
        definition,
        presets,
    } = saved
    else {
        panic!("new definitions do not require rename confirmation");
    };

    assert_eq!(definition.normalized_name, "地點");
    assert_eq!(presets.len(), 2);
    let listed = VariableService::list_definitions(&repository, "game-1").unwrap();
    assert_eq!(listed.len(), 3);
    assert!(
        VariableService::list_definitions(&repository, "game-2")
            .unwrap()
            .iter()
            .all(|item| item.definition.game_id == "game-2")
    );

    VariableService::reorder_presets(
        &mut repository,
        "var-location",
        &["preset-south".into(), "preset-north".into()],
    )
    .unwrap();
    let reordered = VariableService::list_definitions(&repository, "game-1")
        .unwrap()
        .into_iter()
        .find(|item| item.definition.id == "var-location")
        .unwrap();
    assert_eq!(
        reordered
            .presets
            .iter()
            .map(|preset| (preset.id.as_str(), preset.sort_order))
            .collect::<Vec<_>>(),
        vec![("preset-south", 0), ("preset-north", 1)]
    );

    let before = repository.snapshot().unwrap();
    assert!(
        VariableService::reorder_presets(
            &mut repository,
            "var-location",
            &["preset-north".into()],
        )
        .is_err()
    );
    assert_eq!(repository.snapshot().unwrap(), before);
}

#[test]
fn templates_save_previews_rename_before_confirmed_atomic_update() {
    let mut repository = seeded_repository();
    let before = repository.snapshot().unwrap();
    let input = SaveVariableDefinition {
        id: "var-people".into(),
        game_id: "game-1".into(),
        name: "隊伍".into(),
        sort_order: 0,
        rename_confirmed: false,
        presets: vec![SaveVariablePreset {
            id: "preset-1".into(),
            value: "4".into(),
            sort_order: 0,
        }],
    };

    assert_eq!(
        VariableService::save_definition(&mut repository, input.clone()).unwrap(),
        SaveVariableResult::RenameConfirmationRequired {
            affected_phrase_count: 2,
            affected_token_count: 3,
        }
    );
    assert_eq!(repository.snapshot().unwrap(), before);

    let confirmed = VariableService::save_definition(
        &mut repository,
        SaveVariableDefinition {
            rename_confirmed: true,
            ..input
        },
    )
    .unwrap();
    assert!(matches!(confirmed, SaveVariableResult::Saved { .. }));
    assert_eq!(
        repository.snapshot().unwrap().phrases[0].body_template,
        "{隊伍} + {隊伍}"
    );
}

#[test]
fn templates_unicode_case_folding_rejects_logically_duplicate_names() {
    let mut repository = seeded_repository();

    let first = VariableService::save_definition(
        &mut repository,
        SaveVariableDefinition {
            id: "var-street-1".into(),
            game_id: "game-1".into(),
            name: "Straße".into(),
            sort_order: 2,
            rename_confirmed: false,
            presets: vec![],
        },
    );
    assert!(first.is_ok());

    let duplicate = VariableService::save_definition(
        &mut repository,
        SaveVariableDefinition {
            id: "var-street-2".into(),
            game_id: "game-1".into(),
            name: "STRASSE".into(),
            sort_order: 3,
            rename_confirmed: false,
            presets: vec![],
        },
    );
    assert!(duplicate.is_err());
}
