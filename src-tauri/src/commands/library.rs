use std::sync::{Mutex, MutexGuard};

use tauri::State;

use crate::db::Repository;
use crate::db::models::{GameRecord, GroupRecord, LibrarySnapshot, PhraseRecord};
use crate::error::AppError;
use crate::services::library::{
    CreateGameInput, CreateGroupInput, CreatePhraseInput, GameDeleteImpact, GroupDeleteImpact,
    LibraryService, LibraryServiceError, MutationResult, SaveVariableCommandResult,
    SaveVariableDefinition, UpdateGameInput, UpdateGroupInput, UpdatePhraseInput,
    VariableDefinitionWithPresets, VariableServiceError,
};

pub struct LibraryServiceState(Mutex<LibraryService>);

impl LibraryServiceState {
    pub fn new(repository: Repository) -> Self {
        Self(Mutex::new(LibraryService::new(repository)))
    }

    fn lock(&self) -> Result<MutexGuard<'_, LibraryService>, AppError> {
        self.0.lock().map_err(|_| AppError::Internal {
            message_key: "errors.internal",
        })
    }
}

#[tauri::command]
pub fn get_library(state: State<'_, LibraryServiceState>) -> Result<LibrarySnapshot, AppError> {
    let service = state.lock()?;
    service.get_library().map_err(library_error)
}

#[tauri::command]
pub fn create_game(
    state: State<'_, LibraryServiceState>,
    input: CreateGameInput,
) -> Result<MutationResult<GameRecord>, AppError> {
    state.lock()?.create_game(input).map_err(library_error)
}

#[tauri::command]
pub fn update_game(
    state: State<'_, LibraryServiceState>,
    input: UpdateGameInput,
) -> Result<MutationResult<GameRecord>, AppError> {
    state.lock()?.update_game(input).map_err(library_error)
}

#[tauri::command]
pub fn delete_game(
    state: State<'_, LibraryServiceState>,
    game_id: String,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    state.lock()?.delete_game(&game_id).map_err(library_error)
}

#[tauri::command]
pub fn create_group(
    state: State<'_, LibraryServiceState>,
    input: CreateGroupInput,
) -> Result<MutationResult<GroupRecord>, AppError> {
    state.lock()?.create_group(input).map_err(library_error)
}

#[tauri::command]
pub fn update_group(
    state: State<'_, LibraryServiceState>,
    input: UpdateGroupInput,
) -> Result<MutationResult<GroupRecord>, AppError> {
    state.lock()?.update_group(input).map_err(library_error)
}

#[tauri::command]
pub fn delete_group(
    state: State<'_, LibraryServiceState>,
    group_id: String,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    state.lock()?.delete_group(&group_id).map_err(library_error)
}

#[tauri::command]
pub fn create_phrase(
    state: State<'_, LibraryServiceState>,
    input: CreatePhraseInput,
) -> Result<MutationResult<PhraseRecord>, AppError> {
    state.lock()?.create_phrase(input).map_err(library_error)
}

#[tauri::command]
pub fn update_phrase(
    state: State<'_, LibraryServiceState>,
    input: UpdatePhraseInput,
) -> Result<MutationResult<PhraseRecord>, AppError> {
    state.lock()?.update_phrase(input).map_err(library_error)
}

#[tauri::command]
pub fn delete_phrase(
    state: State<'_, LibraryServiceState>,
    phrase_id: String,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    state
        .lock()?
        .delete_phrase(&phrase_id)
        .map_err(library_error)
}

#[tauri::command]
pub fn duplicate_phrase(
    state: State<'_, LibraryServiceState>,
    phrase_id: String,
    new_phrase_id: String,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    state
        .lock()?
        .duplicate_phrase(&phrase_id, &new_phrase_id)
        .map_err(library_error)
}

#[tauri::command]
pub fn move_phrase(
    state: State<'_, LibraryServiceState>,
    phrase_id: String,
    target_group_id: String,
    target_index: usize,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    state
        .lock()?
        .move_phrase(&phrase_id, &target_group_id, target_index)
        .map_err(library_error)
}

#[tauri::command]
pub fn reorder_games(
    state: State<'_, LibraryServiceState>,
    ordered_ids: Vec<String>,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    state
        .lock()?
        .reorder_games(&ordered_ids)
        .map_err(library_error)
}

#[tauri::command]
pub fn reorder_groups(
    state: State<'_, LibraryServiceState>,
    game_id: String,
    ordered_ids: Vec<String>,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    state
        .lock()?
        .reorder_groups(&game_id, &ordered_ids)
        .map_err(library_error)
}

#[tauri::command]
pub fn reorder_phrases(
    state: State<'_, LibraryServiceState>,
    group_id: String,
    ordered_ids: Vec<String>,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    state
        .lock()?
        .reorder_phrases(&group_id, &ordered_ids)
        .map_err(library_error)
}

#[tauri::command]
pub fn reorder_favorites(
    state: State<'_, LibraryServiceState>,
    game_id: String,
    ordered_ids: Vec<String>,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    state
        .lock()?
        .reorder_favorites(&game_id, &ordered_ids)
        .map_err(library_error)
}

#[tauri::command]
pub fn reorder_variable_definitions(
    state: State<'_, LibraryServiceState>,
    game_id: String,
    ordered_ids: Vec<String>,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    state
        .lock()?
        .reorder_variable_definitions(&game_id, &ordered_ids)
        .map_err(library_error)
}

#[tauri::command]
pub fn set_favorite(
    state: State<'_, LibraryServiceState>,
    phrase_id: String,
    favorite: bool,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    state
        .lock()?
        .set_favorite(&phrase_id, favorite)
        .map_err(library_error)
}

#[tauri::command]
pub fn search_phrases(
    state: State<'_, LibraryServiceState>,
    game_id: String,
    query: String,
) -> Result<Vec<PhraseRecord>, AppError> {
    state
        .lock()?
        .search_phrases(&game_id, &query)
        .map_err(library_error)
}

#[tauri::command]
pub fn undo_operation(
    state: State<'_, LibraryServiceState>,
    operation_id: String,
) -> Result<LibrarySnapshot, AppError> {
    state
        .lock()?
        .undo_operation(&operation_id)
        .map_err(library_error)
}

#[tauri::command]
pub fn get_game_delete_impact(
    state: State<'_, LibraryServiceState>,
    game_id: String,
) -> Result<GameDeleteImpact, AppError> {
    state
        .lock()?
        .game_delete_impact(&game_id)
        .map_err(library_error)
}

#[tauri::command]
pub fn get_group_delete_impact(
    state: State<'_, LibraryServiceState>,
    group_id: String,
) -> Result<GroupDeleteImpact, AppError> {
    state
        .lock()?
        .group_delete_impact(&group_id)
        .map_err(library_error)
}

#[tauri::command]
pub fn list_variable_definitions(
    state: State<'_, LibraryServiceState>,
    game_id: String,
) -> Result<Vec<VariableDefinitionWithPresets>, AppError> {
    let service = state.lock()?;
    service
        .list_variable_definitions(&game_id)
        .map_err(service_error)
}

#[tauri::command]
pub fn save_variable_definition(
    state: State<'_, LibraryServiceState>,
    input: SaveVariableDefinition,
) -> Result<SaveVariableCommandResult, AppError> {
    let mut service = state.lock()?;
    service
        .save_variable_definition(input)
        .map_err(service_error)
}

#[tauri::command]
pub fn reorder_variable_presets(
    state: State<'_, LibraryServiceState>,
    variable_definition_id: String,
    ordered_ids: Vec<String>,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    let mut service = state.lock()?;
    service
        .reorder_variable_presets(&variable_definition_id, &ordered_ids)
        .map_err(service_error)
}

#[tauri::command]
pub fn delete_variable_definition(
    state: State<'_, LibraryServiceState>,
    variable_definition_id: String,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    let mut service = state.lock()?;
    service
        .delete_variable_definition(&variable_definition_id)
        .map_err(service_error)
}

fn library_error(error: LibraryServiceError) -> AppError {
    match error {
        LibraryServiceError::InvalidGameName
        | LibraryServiceError::InvalidGroupName
        | LibraryServiceError::InvalidPhraseTitle
        | LibraryServiceError::InvalidPhraseBody
        | LibraryServiceError::InvalidOrder => AppError::Validation {
            message_key: "errors.validation",
        },
        LibraryServiceError::NotFound
        | LibraryServiceError::UndoExpired
        | LibraryServiceError::UndoNotFound => AppError::NotFound {
            message_key: "errors.notFound",
        },
        LibraryServiceError::UndoConflict => AppError::Validation {
            message_key: "errors.validation",
        },
        LibraryServiceError::Repository(_) => AppError::Database {
            message_key: "errors.database",
        },
    }
}

fn service_error(error: VariableServiceError) -> AppError {
    match error {
        VariableServiceError::DefinitionNotFound => AppError::NotFound {
            message_key: "errors.notFound",
        },
        VariableServiceError::InvalidName
        | VariableServiceError::InvalidPreset
        | VariableServiceError::NameConflict
        | VariableServiceError::InvalidTemplate => AppError::Validation {
            message_key: "errors.validation",
        },
        VariableServiceError::Repository(_) => AppError::Database {
            message_key: "errors.database",
        },
    }
}
