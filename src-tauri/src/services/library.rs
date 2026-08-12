use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;

use crate::db::models::{PhraseVariableRefRecord, VariableDefinitionRecord, VariablePresetRecord};
use crate::db::{LibraryTx, Repository, RepositoryError};

use super::templates::{TemplateService, TemplateToken};

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

            tx.delete_variable_definition(definition_id)?;
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
