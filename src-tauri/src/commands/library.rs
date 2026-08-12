use std::sync::{Mutex, MutexGuard};

use tauri::State;

use crate::db::Repository;
use crate::db::models::{GameRecord, GroupRecord, LibrarySnapshot, PhraseRecord};
use crate::error::AppError;
use crate::services::library::{
    CreateGameInput, CreateGroupInput, CreatePhraseInput, DeleteImpact, GameDeleteImpact,
    GroupDeleteImpact, LibraryService, LibraryServiceError, MutationResult, SaveVariableDefinition,
    SaveVariableResult, UpdateGameInput, UpdateGroupInput, UpdatePhraseInput,
    VariableDefinitionWithPresets, VariableService, VariableServiceError,
};

pub struct RepositoryState(Mutex<LibraryService>);

impl RepositoryState {
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
pub fn get_library(
    state: State<'_, RepositoryState>,
    game_id: Option<String>,
) -> Result<LibrarySnapshot, AppError> {
    let service = state.lock()?;
    let _ = game_id;
    service.get_library().map_err(library_error)
}

#[tauri::command]
pub fn create_game(
    state: State<'_, RepositoryState>,
    input: CreateGameInput,
) -> Result<MutationResult<GameRecord>, AppError> {
    state.lock()?.create_game(input).map_err(library_error)
}

#[tauri::command]
pub fn update_game(
    state: State<'_, RepositoryState>,
    input: UpdateGameInput,
) -> Result<MutationResult<GameRecord>, AppError> {
    state.lock()?.update_game(input).map_err(library_error)
}

#[tauri::command]
pub fn delete_game(
    state: State<'_, RepositoryState>,
    game_id: String,
) -> Result<MutationResult<GameDeleteImpact>, AppError> {
    state.lock()?.delete_game(&game_id).map_err(library_error)
}

#[tauri::command]
pub fn create_group(
    state: State<'_, RepositoryState>,
    input: CreateGroupInput,
) -> Result<MutationResult<GroupRecord>, AppError> {
    state.lock()?.create_group(input).map_err(library_error)
}

#[tauri::command]
pub fn update_group(
    state: State<'_, RepositoryState>,
    input: UpdateGroupInput,
) -> Result<MutationResult<GroupRecord>, AppError> {
    state.lock()?.update_group(input).map_err(library_error)
}

#[tauri::command]
pub fn delete_group(
    state: State<'_, RepositoryState>,
    group_id: String,
) -> Result<MutationResult<GroupDeleteImpact>, AppError> {
    state.lock()?.delete_group(&group_id).map_err(library_error)
}

#[tauri::command]
pub fn create_phrase(
    state: State<'_, RepositoryState>,
    input: CreatePhraseInput,
) -> Result<MutationResult<PhraseRecord>, AppError> {
    state.lock()?.create_phrase(input).map_err(library_error)
}

#[tauri::command]
pub fn update_phrase(
    state: State<'_, RepositoryState>,
    input: UpdatePhraseInput,
) -> Result<MutationResult<PhraseRecord>, AppError> {
    state.lock()?.update_phrase(input).map_err(library_error)
}

#[tauri::command]
pub fn delete_phrase(
    state: State<'_, RepositoryState>,
    phrase_id: String,
) -> Result<MutationResult<PhraseRecord>, AppError> {
    state
        .lock()?
        .delete_phrase(&phrase_id)
        .map_err(library_error)
}

#[tauri::command]
pub fn duplicate_phrase(
    state: State<'_, RepositoryState>,
    phrase_id: String,
    new_phrase_id: String,
) -> Result<MutationResult<PhraseRecord>, AppError> {
    state
        .lock()?
        .duplicate_phrase(&phrase_id, &new_phrase_id)
        .map_err(library_error)
}

#[tauri::command]
pub fn move_phrase(
    state: State<'_, RepositoryState>,
    phrase_id: String,
    target_group_id: String,
    target_index: usize,
) -> Result<MutationResult<PhraseRecord>, AppError> {
    state
        .lock()?
        .move_phrase(&phrase_id, &target_group_id, target_index)
        .map_err(library_error)
}

#[tauri::command]
pub fn reorder_games(
    state: State<'_, RepositoryState>,
    ordered_ids: Vec<String>,
) -> Result<MutationResult<LibrarySnapshot>, AppError> {
    state
        .lock()?
        .reorder_games(&ordered_ids)
        .map_err(library_error)
}

#[tauri::command]
pub fn reorder_groups(
    state: State<'_, RepositoryState>,
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
    state: State<'_, RepositoryState>,
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
    state: State<'_, RepositoryState>,
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
    state: State<'_, RepositoryState>,
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
    state: State<'_, RepositoryState>,
    phrase_id: String,
    favorite: bool,
) -> Result<MutationResult<PhraseRecord>, AppError> {
    state
        .lock()?
        .set_favorite(&phrase_id, favorite)
        .map_err(library_error)
}

#[tauri::command]
pub fn search_phrases(
    state: State<'_, RepositoryState>,
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
    state: State<'_, RepositoryState>,
    operation_id: String,
) -> Result<LibrarySnapshot, AppError> {
    state
        .lock()?
        .undo_operation(&operation_id)
        .map_err(library_error)
}

#[tauri::command]
pub fn get_game_delete_impact(
    state: State<'_, RepositoryState>,
    game_id: String,
) -> Result<GameDeleteImpact, AppError> {
    state
        .lock()?
        .game_delete_impact(&game_id)
        .map_err(library_error)
}

#[tauri::command]
pub fn get_group_delete_impact(
    state: State<'_, RepositoryState>,
    group_id: String,
) -> Result<GroupDeleteImpact, AppError> {
    state
        .lock()?
        .group_delete_impact(&group_id)
        .map_err(library_error)
}

#[tauri::command]
pub fn list_variable_definitions(
    state: State<'_, RepositoryState>,
    game_id: String,
) -> Result<Vec<VariableDefinitionWithPresets>, AppError> {
    let service = state.lock()?;
    VariableService::list_definitions(service.repository(), &game_id).map_err(service_error)
}

#[tauri::command]
pub fn save_variable_definition(
    state: State<'_, RepositoryState>,
    input: SaveVariableDefinition,
) -> Result<SaveVariableResult, AppError> {
    let mut service = state.lock()?;
    VariableService::save_definition(service.repository_mut(), input).map_err(service_error)
}

#[tauri::command]
pub fn reorder_variable_presets(
    state: State<'_, RepositoryState>,
    variable_definition_id: String,
    ordered_ids: Vec<String>,
) -> Result<(), AppError> {
    let mut service = state.lock()?;
    VariableService::reorder_presets(
        service.repository_mut(),
        &variable_definition_id,
        &ordered_ids,
    )
    .map_err(service_error)
}

#[tauri::command]
pub fn delete_variable_definition(
    state: State<'_, RepositoryState>,
    variable_definition_id: String,
) -> Result<DeleteImpact, AppError> {
    let mut service = state.lock()?;
    VariableService::delete_definition(service.repository_mut(), &variable_definition_id)
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
