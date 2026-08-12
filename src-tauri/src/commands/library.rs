use std::sync::{Mutex, MutexGuard};

use tauri::State;

use crate::db::Repository;
use crate::error::AppError;
use crate::services::library::{
    DeleteImpact, SaveVariableDefinition, SaveVariableResult, VariableDefinitionWithPresets,
    VariableService, VariableServiceError,
};

pub struct RepositoryState(Mutex<Repository>);

impl RepositoryState {
    pub fn new(repository: Repository) -> Self {
        Self(Mutex::new(repository))
    }

    fn lock(&self) -> Result<MutexGuard<'_, Repository>, AppError> {
        self.0.lock().map_err(|_| AppError::Internal {
            message_key: "errors.internal",
        })
    }
}

#[tauri::command]
pub fn list_variable_definitions(
    state: State<'_, RepositoryState>,
    game_id: String,
) -> Result<Vec<VariableDefinitionWithPresets>, AppError> {
    let repository = state.lock()?;
    VariableService::list_definitions(&repository, &game_id).map_err(service_error)
}

#[tauri::command]
pub fn save_variable_definition(
    state: State<'_, RepositoryState>,
    input: SaveVariableDefinition,
) -> Result<SaveVariableResult, AppError> {
    let mut repository = state.lock()?;
    VariableService::save_definition(&mut repository, input).map_err(service_error)
}

#[tauri::command]
pub fn reorder_variable_presets(
    state: State<'_, RepositoryState>,
    variable_definition_id: String,
    ordered_ids: Vec<String>,
) -> Result<(), AppError> {
    let mut repository = state.lock()?;
    VariableService::reorder_presets(&mut repository, &variable_definition_id, &ordered_ids)
        .map_err(service_error)
}

#[tauri::command]
pub fn delete_variable_definition(
    state: State<'_, RepositoryState>,
    variable_definition_id: String,
) -> Result<DeleteImpact, AppError> {
    let mut repository = state.lock()?;
    VariableService::delete_definition(&mut repository, &variable_definition_id)
        .map_err(service_error)
}

fn service_error(error: VariableServiceError) -> AppError {
    match error {
        VariableServiceError::DefinitionNotFound => AppError::NotFound {
            message_key: "errors.notFound",
        },
        VariableServiceError::InvalidName
        | VariableServiceError::InvalidPreset
        | VariableServiceError::InvalidTemplate => AppError::Validation {
            message_key: "errors.validation",
        },
        VariableServiceError::Repository(_) => AppError::Database {
            message_key: "errors.database",
        },
    }
}
