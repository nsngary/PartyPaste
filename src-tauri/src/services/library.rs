use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;

use crate::db::models::{
    GameRecord, GroupRecord, LibrarySnapshot, OverlayDisplayMode, PhraseRecord,
    PhraseVariableRefRecord, VariableDefinitionRecord, VariablePresetRecord,
};
use crate::db::{LibraryTx, Repository, RepositoryError};

use super::templates::{TemplateService, TemplateToken};

const UNDO_VALIDITY_MS: u64 = 10_000;
const UNDO_CAPACITY: usize = 32;
static OPERATION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn validate_library_text(value: &str, maximum: usize) -> Option<String> {
    let normalized = value.trim().nfkc().collect::<String>();
    let length = normalized.chars().count();
    (length > 0 && length <= maximum).then_some(normalized)
}

fn validate_phrase_body(value: &str) -> Option<String> {
    let normalized = value.nfkc().collect::<String>();
    (!normalized.trim().is_empty() && normalized.chars().count() <= 4000).then_some(normalized)
}

fn normalize_hotkey(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let normalized = value.trim().nfkc().collect::<String>();
        (!normalized.is_empty()).then_some(normalized)
    })
}

fn normalize_search(value: &str) -> String {
    value.trim().nfkc().case_fold().collect()
}

fn map_repository_error(error: RepositoryError) -> LibraryServiceError {
    match error {
        RepositoryError::InvalidSiblingOrder | RepositoryError::SortOrderOverflow => {
            LibraryServiceError::InvalidOrder
        }
        other => LibraryServiceError::Repository(other),
    }
}

fn refresh_phrase_references(
    tx: &mut LibraryTx<'_>,
    phrase: &PhraseRecord,
) -> Result<(), LibraryServiceError> {
    let group = tx
        .group(&phrase.group_id)?
        .ok_or(LibraryServiceError::NotFound)?;
    let definitions = tx.variable_definitions_for_game(&group.game_id)?;
    let by_name = definitions
        .iter()
        .map(|definition| (definition.normalized_name.as_str(), definition.id.as_str()))
        .collect::<HashMap<_, _>>();
    let scan = TemplateService::scan(&phrase.body_template);
    if !scan.issues.is_empty() {
        return Err(LibraryServiceError::InvalidPhraseBody);
    }
    let references = scan
        .tokens
        .iter()
        .filter_map(|token| match token {
            TemplateToken::Variable { name } => Some(name),
            TemplateToken::Text { .. } => None,
        })
        .enumerate()
        .filter_map(|(order, name)| {
            by_name
                .get(normalize_search(name).as_str())
                .map(|definition_id| PhraseVariableRefRecord {
                    phrase_id: phrase.id.clone(),
                    variable_definition_id: (*definition_id).to_owned(),
                    token_order: order as i64,
                })
        })
        .collect::<Vec<_>>();
    tx.replace_phrase_variable_refs(&phrase.id, &references)?;
    Ok(())
}

#[derive(Debug, Error)]
pub enum LibraryServiceError {
    #[error("game name is invalid")]
    InvalidGameName,
    #[error("group name is invalid")]
    InvalidGroupName,
    #[error("phrase title is invalid")]
    InvalidPhraseTitle,
    #[error("phrase body is invalid")]
    InvalidPhraseBody,
    #[error("library record was not found")]
    NotFound,
    #[error("library order is invalid")]
    InvalidOrder,
    #[error("undo operation expired")]
    UndoExpired,
    #[error("undo operation was not found")]
    UndoNotFound,
    #[error("undo operation conflicts with later changes")]
    UndoConflict,
    #[error(transparent)]
    Repository(#[from] RepositoryError),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGameInput {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGameInput {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupInput {
    pub id: String,
    pub game_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGroupInput {
    pub id: String,
    pub name: String,
    pub collapsed: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePhraseInput {
    pub id: String,
    pub group_id: String,
    pub title: String,
    pub body_template: String,
    pub hotkey: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePhraseInput {
    pub id: String,
    pub title: String,
    pub body_template: String,
    pub hotkey: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoReceipt {
    pub operation_id: String,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult<T> {
    pub value: T,
    pub undo: UndoReceipt,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDeleteImpact {
    pub phrase_count: usize,
    pub phrase_variable_ref_count: usize,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDeleteImpact {
    pub group_count: usize,
    pub phrase_count: usize,
    pub variable_definition_count: usize,
    pub variable_preset_count: usize,
    pub phrase_variable_ref_count: usize,
}

#[derive(Clone)]
enum InverseOperation {
    ReverseChange {
        before: Box<LibrarySnapshot>,
        after: Box<LibrarySnapshot>,
        preserve_later_phrase_bodies: HashSet<String>,
    },
}

struct JournalEntry {
    operation_id: String,
    expires_at: u64,
    inverse: InverseOperation,
}

struct UndoJournal {
    entries: VecDeque<JournalEntry>,
}

impl UndoJournal {
    fn new() -> Self {
        Self {
            entries: VecDeque::with_capacity(UNDO_CAPACITY),
        }
    }

    fn record(&mut self, before: LibrarySnapshot, after: LibrarySnapshot, now: u64) -> UndoReceipt {
        self.record_with_body_policy(before, after, now, HashSet::new())
    }

    fn record_with_body_policy(
        &mut self,
        before: LibrarySnapshot,
        after: LibrarySnapshot,
        now: u64,
        preserve_later_phrase_bodies: HashSet<String>,
    ) -> UndoReceipt {
        while self.entries.len() >= UNDO_CAPACITY {
            self.entries.pop_front();
        }
        let operation_id = format!(
            "undo-{}",
            OPERATION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let expires_at = now.saturating_add(UNDO_VALIDITY_MS);
        self.entries.push_back(JournalEntry {
            operation_id: operation_id.clone(),
            expires_at,
            inverse: InverseOperation::ReverseChange {
                before: Box::new(before),
                after: Box::new(after),
                preserve_later_phrase_bodies,
            },
        });
        UndoReceipt {
            operation_id,
            expires_at,
        }
    }

    fn get(
        &mut self,
        operation_id: &str,
        now: u64,
    ) -> Result<InverseOperation, LibraryServiceError> {
        let Some(index) = self
            .entries
            .iter()
            .position(|entry| entry.operation_id == operation_id)
        else {
            return Err(LibraryServiceError::UndoNotFound);
        };
        if now >= self.entries[index].expires_at {
            self.entries.remove(index);
            return Err(LibraryServiceError::UndoExpired);
        }
        Ok(self.entries[index].inverse.clone())
    }

    fn consume(&mut self, operation_id: &str) {
        if let Some(index) = self
            .entries
            .iter()
            .position(|entry| entry.operation_id == operation_id)
        {
            self.entries.remove(index);
        }
    }
}

pub struct LibraryService {
    repository: Repository,
    journal: UndoJournal,
    clock: Box<dyn Fn() -> u64 + Send + Sync>,
}

impl LibraryService {
    pub fn new(repository: Repository) -> Self {
        Self::with_clock(repository, || {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |duration| duration.as_millis() as u64)
        })
    }

    pub fn with_clock(
        repository: Repository,
        clock: impl Fn() -> u64 + Send + Sync + 'static,
    ) -> Self {
        Self {
            repository,
            journal: UndoJournal::new(),
            clock: Box::new(clock),
        }
    }

    pub fn repository(&self) -> &Repository {
        &self.repository
    }

    pub fn list_variable_definitions(
        &self,
        game_id: &str,
    ) -> Result<Vec<VariableDefinitionWithPresets>, VariableServiceError> {
        VariableService::list_definitions(&self.repository, game_id)
    }

    pub fn save_variable_definition(
        &mut self,
        input: SaveVariableDefinition,
    ) -> Result<SaveVariableCommandResult, VariableServiceError> {
        let before = self.repository.snapshot()?;
        let rename_confirmed = input.rename_confirmed;
        match VariableService::save_definition(&mut self.repository, input)? {
            SaveVariableResult::Saved {
                definition: _,
                presets: _,
            } => {
                let after = self.repository.snapshot()?;
                let preserve_later_phrase_bodies = if rename_confirmed {
                    before
                        .phrases
                        .iter()
                        .filter(|before_phrase| {
                            after.phrases.iter().any(|after_phrase| {
                                after_phrase.id == before_phrase.id
                                    && after_phrase.body_template != before_phrase.body_template
                            })
                        })
                        .map(|phrase| phrase.id.clone())
                        .collect()
                } else {
                    HashSet::new()
                };
                let undo = self.journal.record_with_body_policy(
                    before,
                    after.clone(),
                    (self.clock)(),
                    preserve_later_phrase_bodies,
                );
                Ok(SaveVariableCommandResult::Saved { value: after, undo })
            }
            SaveVariableResult::RenameConfirmationRequired {
                affected_phrase_count,
                affected_token_count,
            } => Ok(SaveVariableCommandResult::RenameConfirmationRequired {
                affected_phrase_count,
                affected_token_count,
            }),
        }
    }

    pub fn reorder_variable_presets(
        &mut self,
        definition_id: &str,
        ordered_ids: &[String],
    ) -> Result<MutationResult<LibrarySnapshot>, VariableServiceError> {
        let before = self.repository.snapshot()?;
        VariableService::reorder_presets(&mut self.repository, definition_id, ordered_ids)?;
        let after = self.repository.snapshot()?;
        let undo = self.journal.record(before, after.clone(), (self.clock)());
        Ok(MutationResult { value: after, undo })
    }

    pub fn delete_variable_definition(
        &mut self,
        definition_id: &str,
    ) -> Result<MutationResult<LibrarySnapshot>, VariableServiceError> {
        let before = self.repository.snapshot()?;
        VariableService::delete_definition(&mut self.repository, definition_id)?;
        let after = self.repository.snapshot()?;
        let undo = self.journal.record(before, after.clone(), (self.clock)());
        Ok(MutationResult { value: after, undo })
    }

    pub fn get_library(&self) -> Result<LibrarySnapshot, LibraryServiceError> {
        Ok(self.repository.snapshot()?)
    }

    fn mutate<T>(
        &mut self,
        operation: impl FnOnce(&mut Repository) -> Result<T, LibraryServiceError>,
    ) -> Result<MutationResult<T>, LibraryServiceError> {
        let before = self.repository.snapshot()?;
        let value = operation(&mut self.repository)?;
        let after = self.repository.snapshot()?;
        let undo = self.journal.record(before, after, (self.clock)());
        Ok(MutationResult { value, undo })
    }

    pub fn create_game(
        &mut self,
        input: CreateGameInput,
    ) -> Result<MutationResult<GameRecord>, LibraryServiceError> {
        let name =
            validate_library_text(&input.name, 80).ok_or(LibraryServiceError::InvalidGameName)?;
        if input.id.is_empty() {
            return Err(LibraryServiceError::InvalidGameName);
        }
        self.mutate(|repository| {
            let sort_order = repository.snapshot()?.games.len() as i64;
            let record = GameRecord {
                id: input.id,
                name,
                sort_order,
                overlay_display_mode: OverlayDisplayMode::Title,
            };
            repository.transaction(|tx| tx.insert_game(&record))?;
            Ok(record)
        })
    }

    pub fn update_game(
        &mut self,
        input: UpdateGameInput,
    ) -> Result<MutationResult<GameRecord>, LibraryServiceError> {
        let name =
            validate_library_text(&input.name, 80).ok_or(LibraryServiceError::InvalidGameName)?;
        self.mutate(|repository| {
            let mut record = repository
                .snapshot()?
                .games
                .into_iter()
                .find(|game| game.id == input.id)
                .ok_or(LibraryServiceError::NotFound)?;
            record.name = name;
            repository.transaction(|tx| tx.update_game(&record))?;
            Ok(record)
        })
    }

    pub fn create_group(
        &mut self,
        input: CreateGroupInput,
    ) -> Result<MutationResult<GroupRecord>, LibraryServiceError> {
        let name =
            validate_library_text(&input.name, 80).ok_or(LibraryServiceError::InvalidGroupName)?;
        if input.id.is_empty() {
            return Err(LibraryServiceError::InvalidGroupName);
        }
        self.mutate(|repository| {
            let snapshot = repository.snapshot()?;
            if !snapshot.games.iter().any(|game| game.id == input.game_id) {
                return Err(LibraryServiceError::NotFound);
            }
            let sort_order = snapshot
                .groups
                .iter()
                .filter(|group| group.game_id == input.game_id)
                .count() as i64;
            let record = GroupRecord {
                id: input.id,
                game_id: input.game_id,
                name,
                collapsed: false,
                sort_order,
            };
            repository.transaction(|tx| tx.insert_group(&record))?;
            Ok(record)
        })
    }

    pub fn update_group(
        &mut self,
        input: UpdateGroupInput,
    ) -> Result<MutationResult<GroupRecord>, LibraryServiceError> {
        let name =
            validate_library_text(&input.name, 80).ok_or(LibraryServiceError::InvalidGroupName)?;
        self.mutate(|repository| {
            let mut record = repository
                .snapshot()?
                .groups
                .into_iter()
                .find(|group| group.id == input.id)
                .ok_or(LibraryServiceError::NotFound)?;
            record.name = name;
            record.collapsed = input.collapsed;
            repository.transaction(|tx| tx.update_group(&record))?;
            Ok(record)
        })
    }

    pub fn create_phrase(
        &mut self,
        input: CreatePhraseInput,
    ) -> Result<MutationResult<LibrarySnapshot>, LibraryServiceError> {
        let title = validate_library_text(&input.title, 120)
            .ok_or(LibraryServiceError::InvalidPhraseTitle)?;
        let body_template = validate_phrase_body(&input.body_template)
            .ok_or(LibraryServiceError::InvalidPhraseBody)?;
        let hotkey = normalize_hotkey(input.hotkey);
        if input.id.is_empty() {
            return Err(LibraryServiceError::InvalidPhraseTitle);
        }
        self.mutate(|repository| {
            let snapshot = repository.snapshot()?;
            let group = snapshot
                .groups
                .iter()
                .find(|group| group.id == input.group_id)
                .ok_or(LibraryServiceError::NotFound)?;
            let sort_order = snapshot
                .phrases
                .iter()
                .filter(|phrase| phrase.group_id == input.group_id)
                .count() as i64;
            let record = PhraseRecord {
                id: input.id,
                group_id: group.id.clone(),
                title,
                body_template,
                favorite: false,
                favorite_order: None,
                hotkey,
                sort_order,
            };
            repository.transaction_with(|tx| {
                tx.insert_phrase(&record)?;
                refresh_phrase_references(tx, &record)?;
                Ok::<_, LibraryServiceError>(())
            })?;
            Ok(repository.snapshot()?)
        })
    }

    pub fn update_phrase(
        &mut self,
        input: UpdatePhraseInput,
    ) -> Result<MutationResult<LibrarySnapshot>, LibraryServiceError> {
        let title = validate_library_text(&input.title, 120)
            .ok_or(LibraryServiceError::InvalidPhraseTitle)?;
        let body_template = validate_phrase_body(&input.body_template)
            .ok_or(LibraryServiceError::InvalidPhraseBody)?;
        let hotkey = normalize_hotkey(input.hotkey);
        self.mutate(|repository| {
            let mut record = repository
                .snapshot()?
                .phrases
                .into_iter()
                .find(|phrase| phrase.id == input.id)
                .ok_or(LibraryServiceError::NotFound)?;
            record.title = title;
            record.body_template = body_template;
            record.hotkey = hotkey;
            repository.transaction_with(|tx| {
                tx.update_phrase(&record)?;
                refresh_phrase_references(tx, &record)?;
                Ok::<_, LibraryServiceError>(())
            })?;
            Ok(repository.snapshot()?)
        })
    }

    pub fn game_delete_impact(
        &self,
        game_id: &str,
    ) -> Result<GameDeleteImpact, LibraryServiceError> {
        let snapshot = self.repository.snapshot()?;
        if !snapshot.games.iter().any(|game| game.id == game_id) {
            return Err(LibraryServiceError::NotFound);
        }
        let group_ids = snapshot
            .groups
            .iter()
            .filter(|group| group.game_id == game_id)
            .map(|group| group.id.as_str())
            .collect::<Vec<_>>();
        Ok(GameDeleteImpact {
            group_count: group_ids.len(),
            phrase_count: snapshot
                .phrases
                .iter()
                .filter(|phrase| group_ids.contains(&phrase.group_id.as_str()))
                .count(),
            variable_definition_count: snapshot
                .variable_definitions
                .iter()
                .filter(|definition| definition.game_id == game_id)
                .count(),
            variable_preset_count: snapshot
                .variable_presets
                .iter()
                .filter(|preset| {
                    snapshot.variable_definitions.iter().any(|definition| {
                        definition.id == preset.variable_definition_id
                            && definition.game_id == game_id
                    })
                })
                .count(),
            phrase_variable_ref_count: snapshot
                .phrase_variable_refs
                .iter()
                .filter(|reference| {
                    snapshot.phrases.iter().any(|phrase| {
                        phrase.id == reference.phrase_id
                            && group_ids.contains(&phrase.group_id.as_str())
                    })
                })
                .count(),
        })
    }

    pub fn group_delete_impact(
        &self,
        group_id: &str,
    ) -> Result<GroupDeleteImpact, LibraryServiceError> {
        let snapshot = self.repository.snapshot()?;
        if !snapshot.groups.iter().any(|group| group.id == group_id) {
            return Err(LibraryServiceError::NotFound);
        }
        let phrase_ids = snapshot
            .phrases
            .iter()
            .filter(|phrase| phrase.group_id == group_id)
            .map(|phrase| phrase.id.as_str())
            .collect::<Vec<_>>();
        Ok(GroupDeleteImpact {
            phrase_count: phrase_ids.len(),
            phrase_variable_ref_count: snapshot
                .phrase_variable_refs
                .iter()
                .filter(|reference| phrase_ids.contains(&reference.phrase_id.as_str()))
                .count(),
        })
    }

    pub fn delete_game(
        &mut self,
        game_id: &str,
    ) -> Result<MutationResult<LibrarySnapshot>, LibraryServiceError> {
        self.game_delete_impact(game_id)?;
        let game_id = game_id.to_owned();
        self.mutate(|repository| {
            let remaining = repository
                .snapshot()?
                .games
                .into_iter()
                .filter(|game| game.id != game_id)
                .map(|game| game.id)
                .collect::<Vec<_>>();
            repository.transaction_with(|tx| {
                tx.delete_game_with_children(&game_id)?;
                tx.reorder_games(&remaining).map_err(map_repository_error)
            })?;
            Ok(repository.snapshot()?)
        })
    }

    pub fn delete_group(
        &mut self,
        group_id: &str,
    ) -> Result<MutationResult<LibrarySnapshot>, LibraryServiceError> {
        self.group_delete_impact(group_id)?;
        let group_id = group_id.to_owned();
        self.mutate(|repository| {
            let snapshot = repository.snapshot()?;
            let game_id = snapshot
                .groups
                .iter()
                .find(|group| group.id == group_id)
                .map(|group| group.game_id.clone())
                .ok_or(LibraryServiceError::NotFound)?;
            let remaining = snapshot
                .groups
                .iter()
                .filter(|group| group.game_id == game_id && group.id != group_id)
                .map(|group| group.id.clone())
                .collect::<Vec<_>>();
            let mut favorite_ids = snapshot
                .phrases
                .iter()
                .filter(|phrase| phrase.favorite && phrase.group_id != group_id)
                .filter(|phrase| {
                    snapshot
                        .groups
                        .iter()
                        .any(|group| group.id == phrase.group_id && group.game_id == game_id)
                })
                .map(|phrase| phrase.id.clone())
                .collect::<Vec<_>>();
            favorite_ids.sort_by_key(|id| {
                snapshot
                    .phrases
                    .iter()
                    .find(|phrase| &phrase.id == id)
                    .and_then(|phrase| phrase.favorite_order)
            });
            repository.transaction_with(|tx| {
                tx.delete_group_with_children(&group_id)?;
                tx.reorder_groups(&game_id, &remaining)?;
                tx.reorder_favorites(&game_id, &favorite_ids)
                    .map_err(map_repository_error)
            })?;
            Ok(repository.snapshot()?)
        })
    }

    pub fn delete_phrase(
        &mut self,
        phrase_id: &str,
    ) -> Result<MutationResult<LibrarySnapshot>, LibraryServiceError> {
        let phrase_id = phrase_id.to_owned();
        self.mutate(|repository| {
            let snapshot = repository.snapshot()?;
            let record = snapshot
                .phrases
                .iter()
                .find(|phrase| phrase.id == phrase_id)
                .cloned()
                .ok_or(LibraryServiceError::NotFound)?;
            let group_ids = snapshot
                .phrases
                .iter()
                .filter(|phrase| phrase.group_id == record.group_id && phrase.id != phrase_id)
                .map(|phrase| phrase.id.clone())
                .collect::<Vec<_>>();
            let game_id = snapshot
                .groups
                .iter()
                .find(|group| group.id == record.group_id)
                .map(|group| group.game_id.clone())
                .ok_or(LibraryServiceError::NotFound)?;
            let mut favorite_ids = snapshot
                .phrases
                .iter()
                .filter(|phrase| phrase.favorite && phrase.id != phrase_id)
                .filter(|phrase| {
                    snapshot
                        .groups
                        .iter()
                        .any(|group| group.id == phrase.group_id && group.game_id == game_id)
                })
                .map(|phrase| phrase.id.clone())
                .collect::<Vec<_>>();
            favorite_ids.sort_by_key(|id| {
                snapshot
                    .phrases
                    .iter()
                    .find(|phrase| &phrase.id == id)
                    .and_then(|phrase| phrase.favorite_order)
            });
            repository.transaction_with(|tx| {
                tx.delete_phrase(&phrase_id)?;
                tx.reorder_phrases(&record.group_id, &group_ids)?;
                tx.reorder_favorites(&game_id, &favorite_ids)
                    .map_err(map_repository_error)
            })?;
            Ok(repository.snapshot()?)
        })
    }

    pub fn duplicate_phrase(
        &mut self,
        phrase_id: &str,
        new_phrase_id: &str,
    ) -> Result<MutationResult<LibrarySnapshot>, LibraryServiceError> {
        if new_phrase_id.is_empty() {
            return Err(LibraryServiceError::InvalidPhraseTitle);
        }
        let phrase_id = phrase_id.to_owned();
        let new_phrase_id = new_phrase_id.to_owned();
        self.mutate(|repository| {
            let snapshot = repository.snapshot()?;
            let source = snapshot
                .phrases
                .iter()
                .find(|phrase| phrase.id == phrase_id)
                .cloned()
                .ok_or(LibraryServiceError::NotFound)?;
            let mut sibling_ids = snapshot
                .phrases
                .iter()
                .filter(|phrase| phrase.group_id == source.group_id)
                .map(|phrase| phrase.id.clone())
                .collect::<Vec<_>>();
            let insert_at = sibling_ids
                .iter()
                .position(|id| id == &phrase_id)
                .ok_or(LibraryServiceError::NotFound)?
                + 1;
            let mut duplicate = source.clone();
            duplicate.id = new_phrase_id.clone();
            duplicate.favorite = false;
            duplicate.favorite_order = None;
            duplicate.hotkey = None;
            duplicate.sort_order = sibling_ids.len() as i64;
            sibling_ids.insert(insert_at, new_phrase_id);
            repository.transaction_with(|tx| {
                tx.insert_phrase(&duplicate)?;
                refresh_phrase_references(tx, &duplicate)?;
                tx.reorder_phrases(&duplicate.group_id, &sibling_ids)
                    .map_err(map_repository_error)
            })?;
            Ok(repository.snapshot()?)
        })
    }

    pub fn move_phrase(
        &mut self,
        phrase_id: &str,
        target_group_id: &str,
        target_index: usize,
    ) -> Result<MutationResult<LibrarySnapshot>, LibraryServiceError> {
        let phrase_id = phrase_id.to_owned();
        let target_group_id = target_group_id.to_owned();
        self.mutate(|repository| {
            let snapshot = repository.snapshot()?;
            let source = snapshot
                .phrases
                .iter()
                .find(|phrase| phrase.id == phrase_id)
                .ok_or(LibraryServiceError::NotFound)?;
            let source_game = snapshot
                .groups
                .iter()
                .find(|group| group.id == source.group_id)
                .map(|group| group.game_id.as_str())
                .ok_or(LibraryServiceError::NotFound)?;
            let target_game = snapshot
                .groups
                .iter()
                .find(|group| group.id == target_group_id)
                .map(|group| group.game_id.as_str())
                .ok_or(LibraryServiceError::NotFound)?;
            if source_game != target_game {
                return Err(LibraryServiceError::InvalidOrder);
            }
            repository.transaction_with(|tx| {
                tx.move_phrase(&phrase_id, &target_group_id, target_index)
                    .map_err(map_repository_error)
            })?;
            Ok(repository.snapshot()?)
        })
    }

    pub fn reorder_games(
        &mut self,
        ordered_ids: &[String],
    ) -> Result<MutationResult<LibrarySnapshot>, LibraryServiceError> {
        let ids = ordered_ids.to_vec();
        self.mutate(|repository| {
            repository
                .transaction_with(|tx| tx.reorder_games(&ids).map_err(map_repository_error))?;
            Ok(repository.snapshot()?)
        })
    }

    pub fn reorder_groups(
        &mut self,
        game_id: &str,
        ordered_ids: &[String],
    ) -> Result<MutationResult<LibrarySnapshot>, LibraryServiceError> {
        let game_id = game_id.to_owned();
        let ids = ordered_ids.to_vec();
        self.mutate(|repository| {
            repository.transaction_with(|tx| {
                tx.reorder_groups(&game_id, &ids)
                    .map_err(map_repository_error)
            })?;
            Ok(repository.snapshot()?)
        })
    }

    pub fn reorder_phrases(
        &mut self,
        group_id: &str,
        ordered_ids: &[String],
    ) -> Result<MutationResult<LibrarySnapshot>, LibraryServiceError> {
        let group_id = group_id.to_owned();
        let ids = ordered_ids.to_vec();
        self.mutate(|repository| {
            repository.transaction_with(|tx| {
                tx.reorder_phrases(&group_id, &ids)
                    .map_err(map_repository_error)
            })?;
            Ok(repository.snapshot()?)
        })
    }

    pub fn reorder_favorites(
        &mut self,
        game_id: &str,
        ordered_ids: &[String],
    ) -> Result<MutationResult<LibrarySnapshot>, LibraryServiceError> {
        let game_id = game_id.to_owned();
        let ids = ordered_ids.to_vec();
        self.mutate(|repository| {
            repository.transaction_with(|tx| {
                tx.reorder_favorites(&game_id, &ids)
                    .map_err(map_repository_error)
            })?;
            Ok(repository.snapshot()?)
        })
    }

    pub fn reorder_variable_definitions(
        &mut self,
        game_id: &str,
        ordered_ids: &[String],
    ) -> Result<MutationResult<LibrarySnapshot>, LibraryServiceError> {
        let game_id = game_id.to_owned();
        let ids = ordered_ids.to_vec();
        self.mutate(|repository| {
            repository.transaction_with(|tx| {
                tx.reorder_variable_definitions(&game_id, &ids)
                    .map_err(map_repository_error)
            })?;
            Ok(repository.snapshot()?)
        })
    }

    pub fn set_favorite(
        &mut self,
        phrase_id: &str,
        favorite: bool,
    ) -> Result<MutationResult<LibrarySnapshot>, LibraryServiceError> {
        let phrase_id = phrase_id.to_owned();
        self.mutate(|repository| {
            let snapshot = repository.snapshot()?;
            let mut record = snapshot
                .phrases
                .iter()
                .find(|phrase| phrase.id == phrase_id)
                .cloned()
                .ok_or(LibraryServiceError::NotFound)?;
            let game_id = snapshot
                .groups
                .iter()
                .find(|group| group.id == record.group_id)
                .map(|group| group.game_id.clone())
                .ok_or(LibraryServiceError::NotFound)?;
            let mut ids = snapshot
                .phrases
                .iter()
                .filter(|phrase| phrase.favorite)
                .filter(|phrase| {
                    snapshot
                        .groups
                        .iter()
                        .any(|group| group.id == phrase.group_id && group.game_id == game_id)
                })
                .map(|phrase| phrase.id.clone())
                .collect::<Vec<_>>();
            ids.sort_by_key(|id| {
                snapshot
                    .phrases
                    .iter()
                    .find(|phrase| &phrase.id == id)
                    .and_then(|phrase| phrase.favorite_order)
            });
            if favorite {
                if !record.favorite {
                    ids.push(record.id.clone());
                }
                record.favorite = true;
                record.favorite_order = ids
                    .iter()
                    .position(|id| id == &record.id)
                    .map(|index| index as i64);
            } else {
                ids.retain(|id| id != &record.id);
                record.favorite = false;
                record.favorite_order = None;
            }
            repository.transaction_with(|tx| {
                tx.update_phrase(&record)?;
                tx.reorder_favorites(&game_id, &ids)
                    .map_err(map_repository_error)
            })?;
            Ok(repository.snapshot()?)
        })
    }

    pub fn search_phrases(
        &self,
        game_id: &str,
        query: &str,
    ) -> Result<Vec<PhraseRecord>, LibraryServiceError> {
        let needle = normalize_search(query);
        let snapshot = self.repository.snapshot()?;
        let group_ids = snapshot
            .groups
            .iter()
            .filter(|group| group.game_id == game_id)
            .map(|group| group.id.as_str())
            .collect::<Vec<_>>();
        Ok(snapshot
            .phrases
            .into_iter()
            .filter(|phrase| group_ids.contains(&phrase.group_id.as_str()))
            .filter(|phrase| {
                needle.is_empty()
                    || normalize_search(&phrase.title).contains(&needle)
                    || normalize_search(&phrase.body_template).contains(&needle)
                    || phrase
                        .hotkey
                        .as_deref()
                        .is_some_and(|hotkey| normalize_search(hotkey).contains(&needle))
            })
            .collect())
    }

    pub fn undo_operation(
        &mut self,
        operation_id: &str,
    ) -> Result<LibrarySnapshot, LibraryServiceError> {
        let inverse = self.journal.get(operation_id, (self.clock)())?;
        let current = self.repository.snapshot()?;
        let restored = reverse_change(current, inverse)?;
        self.repository.replace_snapshot(&restored)?;
        let restored = self.repository.snapshot()?;
        self.journal.consume(operation_id);
        Ok(restored)
    }
}

fn reverse_change(
    mut current: LibrarySnapshot,
    inverse: InverseOperation,
) -> Result<LibrarySnapshot, LibraryServiceError> {
    let InverseOperation::ReverseChange {
        before,
        after,
        preserve_later_phrase_bodies,
    } = inverse;
    let strict_bodies = HashSet::new();
    let current_orders = SnapshotOrders::from_snapshot(&current);
    reverse_records(
        &mut current.games,
        &before.games,
        &after.games,
        |record| record.id.clone(),
        &strict_bodies,
    )?;
    reverse_records(
        &mut current.groups,
        &before.groups,
        &after.groups,
        |record| record.id.clone(),
        &strict_bodies,
    )?;
    reverse_records(
        &mut current.phrases,
        &before.phrases,
        &after.phrases,
        |record| record.id.clone(),
        &preserve_later_phrase_bodies,
    )?;
    reverse_records(
        &mut current.variable_definitions,
        &before.variable_definitions,
        &after.variable_definitions,
        |record| record.id.clone(),
        &strict_bodies,
    )?;
    reverse_records(
        &mut current.variable_presets,
        &before.variable_presets,
        &after.variable_presets,
        |record| record.id.clone(),
        &strict_bodies,
    )?;
    reverse_records(
        &mut current.settings,
        &before.settings,
        &after.settings,
        |record| record.key.clone(),
        &strict_bodies,
    )?;
    restore_snapshot_orders(&mut current, &before, &after, &current_orders)?;
    rebuild_snapshot_phrase_references(&mut current)?;
    validate_snapshot_relationships(&current)?;
    validate_snapshot_uniques(&current)?;
    Ok(current)
}

fn rebuild_snapshot_phrase_references(
    snapshot: &mut LibrarySnapshot,
) -> Result<(), LibraryServiceError> {
    let game_by_group = snapshot
        .groups
        .iter()
        .map(|group| (group.id.as_str(), group.game_id.as_str()))
        .collect::<HashMap<_, _>>();
    let definitions_by_game = snapshot.variable_definitions.iter().fold(
        HashMap::<&str, HashMap<&str, &str>>::new(),
        |mut definitions, definition| {
            definitions
                .entry(definition.game_id.as_str())
                .or_default()
                .insert(definition.normalized_name.as_str(), definition.id.as_str());
            definitions
        },
    );
    let mut references = Vec::new();
    for phrase in &snapshot.phrases {
        let game_id = game_by_group
            .get(phrase.group_id.as_str())
            .ok_or(LibraryServiceError::UndoConflict)?;
        let definitions = definitions_by_game
            .get(game_id)
            .cloned()
            .unwrap_or_default();
        let scan = TemplateService::scan(&phrase.body_template);
        if !scan.issues.is_empty() {
            return Err(LibraryServiceError::UndoConflict);
        }
        references.extend(
            scan.tokens
                .iter()
                .filter_map(|token| match token {
                    TemplateToken::Variable { name } => Some(name),
                    TemplateToken::Text { .. } => None,
                })
                .enumerate()
                .filter_map(|(token_order, name)| {
                    definitions
                        .get(normalize_search(name).as_str())
                        .map(|variable_definition_id| PhraseVariableRefRecord {
                            phrase_id: phrase.id.clone(),
                            variable_definition_id: (*variable_definition_id).to_owned(),
                            token_order: token_order as i64,
                        })
                }),
        );
    }
    snapshot.phrase_variable_refs = references;
    Ok(())
}

fn validate_snapshot_relationships(snapshot: &LibrarySnapshot) -> Result<(), LibraryServiceError> {
    let valid = snapshot
        .groups
        .iter()
        .all(|group| snapshot.games.iter().any(|game| game.id == group.game_id))
        && snapshot.phrases.iter().all(|phrase| {
            snapshot
                .groups
                .iter()
                .any(|group| group.id == phrase.group_id)
        })
        && snapshot.variable_definitions.iter().all(|definition| {
            snapshot
                .games
                .iter()
                .any(|game| game.id == definition.game_id)
        })
        && snapshot.variable_presets.iter().all(|preset| {
            snapshot
                .variable_definitions
                .iter()
                .any(|definition| definition.id == preset.variable_definition_id)
        })
        && snapshot.phrase_variable_refs.iter().all(|reference| {
            snapshot
                .phrases
                .iter()
                .any(|phrase| phrase.id == reference.phrase_id)
                && snapshot
                    .variable_definitions
                    .iter()
                    .any(|definition| definition.id == reference.variable_definition_id)
        });
    if valid {
        Ok(())
    } else {
        Err(LibraryServiceError::UndoConflict)
    }
}

fn validate_snapshot_uniques(snapshot: &LibrarySnapshot) -> Result<(), LibraryServiceError> {
    let mut game_ids = HashSet::new();
    let mut group_ids = HashSet::new();
    let mut phrase_ids = HashSet::new();
    let mut definition_ids = HashSet::new();
    let mut preset_ids = HashSet::new();
    let record_ids_are_unique = snapshot
        .games
        .iter()
        .all(|record| game_ids.insert(record.id.as_str()))
        && snapshot
            .groups
            .iter()
            .all(|record| group_ids.insert(record.id.as_str()))
        && snapshot
            .phrases
            .iter()
            .all(|record| phrase_ids.insert(record.id.as_str()))
        && snapshot
            .variable_definitions
            .iter()
            .all(|record| definition_ids.insert(record.id.as_str()))
        && snapshot
            .variable_presets
            .iter()
            .all(|record| preset_ids.insert(record.id.as_str()));
    let mut definition_names = HashSet::new();
    let definition_names_are_unique = snapshot.variable_definitions.iter().all(|record| {
        definition_names.insert((record.game_id.as_str(), record.normalized_name.as_str()))
    });
    let mut references = HashSet::new();
    let references_are_unique = snapshot
        .phrase_variable_refs
        .iter()
        .all(|record| references.insert((record.phrase_id.as_str(), record.token_order)));
    let mut settings = HashSet::new();
    let settings_are_unique = snapshot
        .settings
        .iter()
        .all(|record| settings.insert(record.key.as_str()));

    if record_ids_are_unique
        && definition_names_are_unique
        && references_are_unique
        && settings_are_unique
        && snapshot_orders_are_contiguous(snapshot)
    {
        Ok(())
    } else {
        Err(LibraryServiceError::UndoConflict)
    }
}

fn snapshot_orders_are_contiguous(snapshot: &LibrarySnapshot) -> bool {
    let contiguous = |mut orders: Vec<i64>| {
        orders.sort_unstable();
        orders
            .into_iter()
            .enumerate()
            .all(|(index, order)| order == index as i64)
    };
    contiguous(
        snapshot
            .games
            .iter()
            .map(|record| record.sort_order)
            .collect(),
    ) && snapshot.games.iter().all(|game| {
        contiguous(
            snapshot
                .groups
                .iter()
                .filter(|record| record.game_id == game.id)
                .map(|record| record.sort_order)
                .collect(),
        ) && contiguous(
            snapshot
                .variable_definitions
                .iter()
                .filter(|record| record.game_id == game.id)
                .map(|record| record.sort_order)
                .collect(),
        ) && contiguous(
            snapshot
                .phrases
                .iter()
                .filter(|record| {
                    record.favorite
                        && snapshot
                            .groups
                            .iter()
                            .any(|group| group.id == record.group_id && group.game_id == game.id)
                })
                .filter_map(|record| record.favorite_order)
                .collect(),
        )
    }) && snapshot.groups.iter().all(|group| {
        contiguous(
            snapshot
                .phrases
                .iter()
                .filter(|record| record.group_id == group.id)
                .map(|record| record.sort_order)
                .collect(),
        )
    }) && snapshot.variable_definitions.iter().all(|definition| {
        contiguous(
            snapshot
                .variable_presets
                .iter()
                .filter(|record| record.variable_definition_id == definition.id)
                .map(|record| record.sort_order)
                .collect(),
        )
    }) && snapshot
        .phrases
        .iter()
        .all(|record| record.favorite == record.favorite_order.is_some())
}

fn reverse_records<T: Clone + Eq + Serialize + DeserializeOwned>(
    current: &mut Vec<T>,
    before: &[T],
    after: &[T],
    key: impl Fn(&T) -> String,
    preserve_later_body_for: &HashSet<String>,
) -> Result<(), LibraryServiceError> {
    let before_by_id = before
        .iter()
        .map(|record| (key(record), record))
        .collect::<HashMap<_, _>>();
    let after_by_id = after
        .iter()
        .map(|record| (key(record), record))
        .collect::<HashMap<_, _>>();
    let changed_ids = before_by_id
        .keys()
        .chain(after_by_id.keys())
        .filter(|id| before_by_id.get(*id) != after_by_id.get(*id))
        .cloned()
        .collect::<HashSet<_>>();

    for id in changed_ids {
        let current_index = current.iter().position(|record| key(record) == id);
        match (before_by_id.get(&id), after_by_id.get(&id), current_index) {
            (None, Some(after_record), Some(index))
                if equal_except_derived_order(&current[index], after_record)? =>
            {
                current.remove(index);
            }
            (Some(before_record), None, None) => current.push((*before_record).clone()),
            (Some(before_record), Some(after_record), Some(index)) => {
                current[index] = reverse_changed_fields(
                    &current[index],
                    before_record,
                    after_record,
                    preserve_later_body_for.contains(&id),
                )?;
            }
            _ => return Err(LibraryServiceError::UndoConflict),
        }
    }
    Ok(())
}

fn equal_except_derived_order<T: Serialize>(
    current: &T,
    after: &T,
) -> Result<bool, LibraryServiceError> {
    let mut current =
        serde_json::to_value(current).map_err(|_| LibraryServiceError::UndoConflict)?;
    let mut after = serde_json::to_value(after).map_err(|_| LibraryServiceError::UndoConflict)?;
    for value in [&mut current, &mut after] {
        if let Some(object) = value.as_object_mut() {
            object.remove("sortOrder");
            object.remove("favoriteOrder");
        }
    }
    Ok(current == after)
}

fn reverse_changed_fields<T: Serialize + DeserializeOwned>(
    current: &T,
    before: &T,
    after: &T,
    preserve_later_body: bool,
) -> Result<T, LibraryServiceError> {
    let mut current =
        serde_json::to_value(current).map_err(|_| LibraryServiceError::UndoConflict)?;
    let before = serde_json::to_value(before).map_err(|_| LibraryServiceError::UndoConflict)?;
    let after = serde_json::to_value(after).map_err(|_| LibraryServiceError::UndoConflict)?;
    let (Some(current), Some(before), Some(after)) = (
        current.as_object_mut(),
        before.as_object(),
        after.as_object(),
    ) else {
        return Err(LibraryServiceError::UndoConflict);
    };
    for (field, before_value) in before {
        if field == "sortOrder" || field == "favoriteOrder" {
            continue;
        }
        let after_value = after.get(field).ok_or(LibraryServiceError::UndoConflict)?;
        if before_value != after_value {
            if current.get(field) != Some(after_value) {
                if field == "bodyTemplate" && preserve_later_body {
                    continue;
                }
                return Err(LibraryServiceError::UndoConflict);
            }
            current.insert(field.clone(), before_value.clone());
        }
    }
    serde_json::from_value(serde_json::Value::Object(current.clone()))
        .map_err(|_| LibraryServiceError::UndoConflict)
}

#[derive(Default)]
struct SnapshotOrders {
    games: Vec<String>,
    groups: HashMap<String, Vec<String>>,
    phrases: HashMap<String, Vec<String>>,
    favorites: HashMap<String, Vec<String>>,
    definitions: HashMap<String, Vec<String>>,
    presets: HashMap<String, Vec<String>>,
}

impl SnapshotOrders {
    fn from_snapshot(snapshot: &LibrarySnapshot) -> Self {
        let mut orders = Self {
            games: ordered_ids(
                &snapshot.games,
                |record| record.sort_order,
                |record| record.id.clone(),
            ),
            ..Self::default()
        };
        for game in &snapshot.games {
            orders.groups.insert(
                game.id.clone(),
                ordered_ids(
                    &snapshot
                        .groups
                        .iter()
                        .filter(|record| record.game_id == game.id)
                        .collect::<Vec<_>>(),
                    |record| record.sort_order,
                    |record| record.id.clone(),
                ),
            );
            let group_ids = snapshot
                .groups
                .iter()
                .filter(|record| record.game_id == game.id)
                .map(|record| record.id.as_str())
                .collect::<HashSet<_>>();
            orders.favorites.insert(
                game.id.clone(),
                ordered_ids(
                    &snapshot
                        .phrases
                        .iter()
                        .filter(|record| {
                            record.favorite && group_ids.contains(record.group_id.as_str())
                        })
                        .collect::<Vec<_>>(),
                    |record| record.favorite_order.unwrap_or(i64::MAX),
                    |record| record.id.clone(),
                ),
            );
            orders.definitions.insert(
                game.id.clone(),
                ordered_ids(
                    &snapshot
                        .variable_definitions
                        .iter()
                        .filter(|record| record.game_id == game.id)
                        .collect::<Vec<_>>(),
                    |record| record.sort_order,
                    |record| record.id.clone(),
                ),
            );
        }
        for group in &snapshot.groups {
            orders.phrases.insert(
                group.id.clone(),
                ordered_ids(
                    &snapshot
                        .phrases
                        .iter()
                        .filter(|record| record.group_id == group.id)
                        .collect::<Vec<_>>(),
                    |record| record.sort_order,
                    |record| record.id.clone(),
                ),
            );
        }
        for definition in &snapshot.variable_definitions {
            orders.presets.insert(
                definition.id.clone(),
                ordered_ids(
                    &snapshot
                        .variable_presets
                        .iter()
                        .filter(|record| record.variable_definition_id == definition.id)
                        .collect::<Vec<_>>(),
                    |record| record.sort_order,
                    |record| record.id.clone(),
                ),
            );
        }
        orders
    }
}

fn ordered_ids<T>(
    records: &[T],
    order: impl Fn(&T) -> i64,
    key: impl Fn(&T) -> String,
) -> Vec<String> {
    let mut records = records.iter().collect::<Vec<_>>();
    records.sort_by_key(|record| order(record));
    records.into_iter().map(key).collect()
}

fn reverse_order(
    current: &[String],
    fallback: Vec<String>,
    before: &[String],
    after: &[String],
) -> Result<Vec<String>, LibraryServiceError> {
    let valid = fallback.iter().map(String::as_str).collect::<HashSet<_>>();
    let after_ids = after.iter().map(String::as_str).collect::<HashSet<_>>();
    let restored = before
        .iter()
        .filter(|id| !after_ids.contains(id.as_str()) && valid.contains(id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    let mut result = current
        .iter()
        .filter(|id| valid.contains(id.as_str()))
        .cloned()
        .collect::<Vec<_>>();

    if restored.is_empty() {
        let common = before
            .iter()
            .filter(|id| after_ids.contains(id.as_str()) && valid.contains(id.as_str()))
            .cloned()
            .collect::<HashSet<_>>();
        let before_common = before
            .iter()
            .filter(|id| common.contains(*id))
            .cloned()
            .collect::<Vec<_>>();
        let after_common = after
            .iter()
            .filter(|id| common.contains(*id))
            .cloned()
            .collect::<Vec<_>>();
        if before_common != after_common {
            let current_common = result
                .iter()
                .filter(|id| common.contains(*id))
                .cloned()
                .collect::<Vec<_>>();
            if current_common != after_common {
                return Err(LibraryServiceError::UndoConflict);
            }
            let mut desired = before_common.into_iter();
            for id in &mut result {
                if common.contains(id) {
                    *id = desired.next().ok_or(LibraryServiceError::UndoConflict)?;
                }
            }
        }
        return Ok(result);
    }

    for restored_id in restored {
        let before_index = before.iter().position(|id| id == &restored_id).unwrap_or(0);
        let successor = before[before_index + 1..]
            .iter()
            .find_map(|id| result.iter().position(|candidate| candidate == id));
        if let Some(index) = successor {
            result.insert(index, restored_id);
            continue;
        }
        let predecessor = before[..before_index]
            .iter()
            .rev()
            .find_map(|id| result.iter().position(|candidate| candidate == id));
        result.insert(
            predecessor.map_or(result.len(), |index| index + 1),
            restored_id,
        );
    }
    Ok(result)
}

fn restore_snapshot_orders(
    snapshot: &mut LibrarySnapshot,
    before: &LibrarySnapshot,
    after: &LibrarySnapshot,
    current: &SnapshotOrders,
) -> Result<(), LibraryServiceError> {
    let before_orders = SnapshotOrders::from_snapshot(before);
    let after_orders = SnapshotOrders::from_snapshot(after);
    let fallback = ordered_ids(
        &snapshot.games,
        |record| record.sort_order,
        |record| record.id.clone(),
    );
    let order = reverse_order(
        &current.games,
        fallback,
        &before_orders.games,
        &after_orders.games,
    )?;
    for record in &mut snapshot.games {
        record.sort_order = order
            .iter()
            .position(|id| id == &record.id)
            .unwrap_or(order.len()) as i64;
    }

    for record in snapshot
        .phrases
        .iter_mut()
        .filter(|record| !record.favorite)
    {
        record.favorite_order = None;
    }

    let game_ids = snapshot
        .games
        .iter()
        .map(|record| record.id.clone())
        .collect::<Vec<_>>();
    for game_id in game_ids {
        let fallback = ordered_ids(
            &snapshot
                .groups
                .iter()
                .filter(|record| record.game_id == game_id)
                .collect::<Vec<_>>(),
            |record| record.sort_order,
            |record| record.id.clone(),
        );
        let order = reverse_order(
            current.groups.get(&game_id).map_or(&[], Vec::as_slice),
            fallback,
            before_orders
                .groups
                .get(&game_id)
                .map_or(&[], Vec::as_slice),
            after_orders.groups.get(&game_id).map_or(&[], Vec::as_slice),
        )?;
        for record in snapshot
            .groups
            .iter_mut()
            .filter(|record| record.game_id == game_id)
        {
            record.sort_order = order
                .iter()
                .position(|id| id == &record.id)
                .unwrap_or(order.len()) as i64;
        }

        let group_ids = snapshot
            .groups
            .iter()
            .filter(|record| record.game_id == game_id)
            .map(|record| record.id.as_str())
            .collect::<HashSet<_>>();
        let fallback = ordered_ids(
            &snapshot
                .phrases
                .iter()
                .filter(|record| record.favorite && group_ids.contains(record.group_id.as_str()))
                .collect::<Vec<_>>(),
            |record| record.favorite_order.unwrap_or(i64::MAX),
            |record| record.id.clone(),
        );
        let order = reverse_order(
            current.favorites.get(&game_id).map_or(&[], Vec::as_slice),
            fallback,
            before_orders
                .favorites
                .get(&game_id)
                .map_or(&[], Vec::as_slice),
            after_orders
                .favorites
                .get(&game_id)
                .map_or(&[], Vec::as_slice),
        )?;
        for record in snapshot
            .phrases
            .iter_mut()
            .filter(|record| record.favorite && group_ids.contains(record.group_id.as_str()))
        {
            record.favorite_order = order
                .iter()
                .position(|id| id == &record.id)
                .map(|index| index as i64);
        }

        let fallback = ordered_ids(
            &snapshot
                .variable_definitions
                .iter()
                .filter(|record| record.game_id == game_id)
                .collect::<Vec<_>>(),
            |record| record.sort_order,
            |record| record.id.clone(),
        );
        let order = reverse_order(
            current.definitions.get(&game_id).map_or(&[], Vec::as_slice),
            fallback,
            before_orders
                .definitions
                .get(&game_id)
                .map_or(&[], Vec::as_slice),
            after_orders
                .definitions
                .get(&game_id)
                .map_or(&[], Vec::as_slice),
        )?;
        for record in snapshot
            .variable_definitions
            .iter_mut()
            .filter(|record| record.game_id == game_id)
        {
            record.sort_order = order
                .iter()
                .position(|id| id == &record.id)
                .unwrap_or(order.len()) as i64;
        }
    }

    let group_ids = snapshot
        .groups
        .iter()
        .map(|record| record.id.clone())
        .collect::<Vec<_>>();
    for group_id in group_ids {
        let fallback = ordered_ids(
            &snapshot
                .phrases
                .iter()
                .filter(|record| record.group_id == group_id)
                .collect::<Vec<_>>(),
            |record| record.sort_order,
            |record| record.id.clone(),
        );
        let order = reverse_order(
            current.phrases.get(&group_id).map_or(&[], Vec::as_slice),
            fallback,
            before_orders
                .phrases
                .get(&group_id)
                .map_or(&[], Vec::as_slice),
            after_orders
                .phrases
                .get(&group_id)
                .map_or(&[], Vec::as_slice),
        )?;
        for record in snapshot
            .phrases
            .iter_mut()
            .filter(|record| record.group_id == group_id)
        {
            record.sort_order = order
                .iter()
                .position(|id| id == &record.id)
                .unwrap_or(order.len()) as i64;
        }
    }

    let definition_ids = snapshot
        .variable_definitions
        .iter()
        .map(|record| record.id.clone())
        .collect::<Vec<_>>();
    for definition_id in definition_ids {
        let fallback = ordered_ids(
            &snapshot
                .variable_presets
                .iter()
                .filter(|record| record.variable_definition_id == definition_id)
                .collect::<Vec<_>>(),
            |record| record.sort_order,
            |record| record.id.clone(),
        );
        let order = reverse_order(
            current
                .presets
                .get(&definition_id)
                .map_or(&[], Vec::as_slice),
            fallback,
            before_orders
                .presets
                .get(&definition_id)
                .map_or(&[], Vec::as_slice),
            after_orders
                .presets
                .get(&definition_id)
                .map_or(&[], Vec::as_slice),
        )?;
        for record in snapshot
            .variable_presets
            .iter_mut()
            .filter(|record| record.variable_definition_id == definition_id)
        {
            record.sort_order = order
                .iter()
                .position(|id| id == &record.id)
                .unwrap_or(order.len()) as i64;
        }
    }
    Ok(())
}

#[derive(Debug, Error)]
pub enum VariableServiceError {
    #[error("variable definition was not found")]
    DefinitionNotFound,
    #[error("variable name is invalid")]
    InvalidName,
    #[error("variable preset is invalid")]
    InvalidPreset,
    #[error("variable name conflicts with an existing definition")]
    NameConflict,
    #[error("stored phrase template is invalid")]
    InvalidTemplate,
    #[error(transparent)]
    Repository(#[from] RepositoryError),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVariablePreset {
    pub id: String,
    pub value: String,
    pub sort_order: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVariableDefinition {
    pub id: String,
    pub game_id: String,
    pub name: String,
    pub sort_order: i64,
    #[serde(default)]
    pub rename_confirmed: bool,
    pub presets: Vec<SaveVariablePreset>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableDefinitionWithPresets {
    pub definition: VariableDefinitionRecord,
    pub presets: Vec<VariablePresetRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SaveVariableResult {
    Saved {
        definition: VariableDefinitionRecord,
        presets: Vec<VariablePresetRecord>,
    },
    RenameConfirmationRequired {
        affected_phrase_count: usize,
        affected_token_count: usize,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SaveVariableCommandResult {
    Saved {
        value: LibrarySnapshot,
        undo: UndoReceipt,
    },
    RenameConfirmationRequired {
        affected_phrase_count: usize,
        affected_token_count: usize,
    },
}

impl SaveVariableCommandResult {
    pub fn undo_receipt(&self) -> Option<&UndoReceipt> {
        match self {
            Self::Saved { undo, .. } => Some(undo),
            Self::RenameConfirmationRequired { .. } => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameImpact {
    pub affected_phrase_count: usize,
    pub affected_token_count: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteImpact {
    pub affected_phrase_count: usize,
}

pub struct VariableService;

impl VariableService {
    pub fn list_definitions(
        repository: &Repository,
        game_id: &str,
    ) -> Result<Vec<VariableDefinitionWithPresets>, VariableServiceError> {
        let snapshot = repository.snapshot()?;
        Ok(snapshot
            .variable_definitions
            .into_iter()
            .filter(|definition| definition.game_id == game_id)
            .map(|definition| {
                let presets = snapshot
                    .variable_presets
                    .iter()
                    .filter(|preset| preset.variable_definition_id == definition.id)
                    .cloned()
                    .collect();
                VariableDefinitionWithPresets {
                    definition,
                    presets,
                }
            })
            .collect())
    }

    pub fn save_definition(
        repository: &mut Repository,
        input: SaveVariableDefinition,
    ) -> Result<SaveVariableResult, VariableServiceError> {
        let name = validate_name(&input.name)?;
        let normalized_name = normalize_name(&name);
        if input.id.is_empty() || input.game_id.is_empty() || input.sort_order < 0 {
            return Err(VariableServiceError::InvalidName);
        }
        let presets = input
            .presets
            .into_iter()
            .map(|preset| {
                if preset.id.is_empty() || preset.sort_order < 0 {
                    return Err(VariableServiceError::InvalidPreset);
                }
                let value = preset.value.trim();
                if value.is_empty() || value.chars().count() > 200 {
                    return Err(VariableServiceError::InvalidPreset);
                }
                Ok(VariablePresetRecord {
                    id: preset.id,
                    variable_definition_id: input.id.clone(),
                    value: value.to_owned(),
                    sort_order: preset.sort_order,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let record = VariableDefinitionRecord {
            id: input.id,
            game_id: input.game_id,
            name,
            normalized_name,
            sort_order: input.sort_order,
        };

        let rename_preview = repository.transaction_with(|tx| {
            if let Some(existing) = tx.variable_definition(&record.id)? {
                if existing.game_id != record.game_id {
                    return Err(VariableServiceError::DefinitionNotFound);
                }
                if existing.name != record.name {
                    if !input.rename_confirmed {
                        return rename_impact_in_transaction(tx, &existing).map(Some);
                    }
                    rename_in_transaction(tx, &existing, &record.name, &record.normalized_name)?;
                }
                tx.update_variable_definition(&record)?;
            } else {
                tx.insert_variable_definition(&record)?;
            }
            tx.replace_variable_presets(&record.id, &presets)?;
            Ok(None)
        })?;

        if let Some(impact) = rename_preview {
            return Ok(SaveVariableResult::RenameConfirmationRequired {
                affected_phrase_count: impact.affected_phrase_count,
                affected_token_count: impact.affected_token_count,
            });
        }

        let saved = Self::list_definitions(repository, &record.game_id)?
            .into_iter()
            .find(|saved| saved.definition.id == record.id)
            .ok_or(VariableServiceError::DefinitionNotFound)?;
        Ok(SaveVariableResult::Saved {
            definition: saved.definition,
            presets: saved.presets,
        })
    }

    pub fn rename_definition(
        repository: &mut Repository,
        definition_id: &str,
        new_name: &str,
    ) -> Result<RenameImpact, VariableServiceError> {
        let name = validate_name(new_name)?;
        let normalized_name = normalize_name(&name);

        repository.transaction_with(|tx| {
            let definition = tx
                .variable_definition(definition_id)?
                .ok_or(VariableServiceError::DefinitionNotFound)?;
            rename_in_transaction(tx, &definition, &name, &normalized_name)
        })
    }

    pub fn reorder_presets(
        repository: &mut Repository,
        definition_id: &str,
        ordered_ids: &[String],
    ) -> Result<(), VariableServiceError> {
        repository.transaction_with(|tx| {
            if tx.variable_definition(definition_id)?.is_none() {
                return Err(VariableServiceError::DefinitionNotFound);
            }
            tx.reorder_variable_presets(definition_id, ordered_ids)?;
            Ok(())
        })
    }

    pub fn delete_definition(
        repository: &mut Repository,
        definition_id: &str,
    ) -> Result<DeleteImpact, VariableServiceError> {
        repository.transaction_with(|tx| {
            let definition = tx
                .variable_definition(definition_id)?
                .ok_or(VariableServiceError::DefinitionNotFound)?;
            let affected_phrase_count = tx
                .phrases_for_game(&definition.game_id)?
                .iter()
                .filter(|phrase| {
                    TemplateService::scan(&phrase.body_template)
                        .tokens
                        .iter()
                        .any(|token| {
                            matches!(
                                token,
                                TemplateToken::Variable { name }
                                    if normalize_name(name) == definition.normalized_name
                            )
                        })
                })
                .count();

            let remaining_ids = tx
                .variable_definitions_for_game(&definition.game_id)?
                .into_iter()
                .filter(|candidate| candidate.id != definition_id)
                .map(|candidate| candidate.id)
                .collect::<Vec<_>>();
            tx.delete_variable_definition(definition_id)?;
            tx.reorder_variable_definitions(&definition.game_id, &remaining_ids)?;
            Ok(DeleteImpact {
                affected_phrase_count,
            })
        })
    }
}

fn rename_in_transaction(
    tx: &mut LibraryTx<'_>,
    definition: &VariableDefinitionRecord,
    new_name: &str,
    normalized_name: &str,
) -> Result<RenameImpact, VariableServiceError> {
    let definitions = tx.variable_definitions_for_game(&definition.game_id)?;
    if definitions.iter().any(|candidate| {
        candidate.id != definition.id && candidate.normalized_name == normalized_name
    }) {
        return Err(VariableServiceError::NameConflict);
    }
    let definition_ids = definitions
        .iter()
        .map(|candidate| (candidate.normalized_name.as_str(), candidate.id.as_str()))
        .collect::<HashMap<_, _>>();
    let mut affected_phrase_count = 0;
    let mut affected_token_count = 0;

    for phrase in tx.phrases_for_game(&definition.game_id)? {
        let mut scan = TemplateService::scan(&phrase.body_template);
        if !scan.issues.is_empty() {
            return Err(VariableServiceError::InvalidTemplate);
        }
        let mut references = Vec::new();
        let mut variable_order = 0i64;
        let mut phrase_changed = false;

        for token in &mut scan.tokens {
            let TemplateToken::Variable { name } = token else {
                continue;
            };
            let token_definition_id = if normalize_name(name) == definition.normalized_name {
                *name = new_name.to_owned();
                phrase_changed = true;
                affected_token_count += 1;
                Some(definition.id.as_str())
            } else {
                definition_ids.get(normalize_name(name).as_str()).copied()
            };
            if let Some(variable_definition_id) = token_definition_id {
                references.push(PhraseVariableRefRecord {
                    phrase_id: phrase.id.clone(),
                    variable_definition_id: variable_definition_id.to_owned(),
                    token_order: variable_order,
                });
            }
            variable_order += 1;
        }

        if phrase_changed {
            affected_phrase_count += 1;
            tx.update_phrase_body(&phrase.id, &TemplateService::render(&scan.tokens))?;
            tx.replace_phrase_variable_refs(&phrase.id, &references)?;
        }
    }

    tx.update_variable_definition(&VariableDefinitionRecord {
        name: new_name.to_owned(),
        normalized_name: normalized_name.to_owned(),
        ..definition.clone()
    })?;

    Ok(RenameImpact {
        affected_phrase_count,
        affected_token_count,
    })
}

fn rename_impact_in_transaction(
    tx: &LibraryTx<'_>,
    definition: &VariableDefinitionRecord,
) -> Result<RenameImpact, VariableServiceError> {
    let mut affected_phrase_count = 0;
    let mut affected_token_count = 0;
    for phrase in tx.phrases_for_game(&definition.game_id)? {
        let scan = TemplateService::scan(&phrase.body_template);
        if !scan.issues.is_empty() {
            return Err(VariableServiceError::InvalidTemplate);
        }
        let phrase_token_count = scan
            .tokens
            .iter()
            .filter(|token| {
                matches!(
                    token,
                    TemplateToken::Variable { name }
                        if normalize_name(name) == definition.normalized_name
                )
            })
            .count();
        if phrase_token_count > 0 {
            affected_phrase_count += 1;
            affected_token_count += phrase_token_count;
        }
    }
    Ok(RenameImpact {
        affected_phrase_count,
        affected_token_count,
    })
}

fn validate_name(name: &str) -> Result<String, VariableServiceError> {
    let name = name.trim();
    let length = name.chars().count();
    if !(1..=40).contains(&length)
        || name
            .chars()
            .any(|character| character.is_control() || character == '{' || character == '}')
    {
        return Err(VariableServiceError::InvalidName);
    }
    Ok(name.to_owned())
}

fn normalize_name(name: &str) -> String {
    name.trim().nfkc().case_fold().collect()
}
