use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use tauri::State;

use crate::error::AppError;
use crate::services::backup::{BackupError, BackupService, ImportPreviewDto};

pub struct BackupServiceState(Mutex<BackupService>);

impl BackupServiceState {
    pub fn new(service: BackupService) -> Self {
        Self(Mutex::new(service))
    }

    fn lock(&self) -> Result<MutexGuard<'_, BackupService>, AppError> {
        self.0.lock().map_err(|_| AppError::Internal {
            message_key: "errors.internal",
        })
    }
}

#[tauri::command]
pub fn export_backup(state: State<'_, BackupServiceState>, path: String) -> Result<(), AppError> {
    state
        .lock()?
        .export_backup(Path::new(&path))
        .map_err(backup_error)
}

#[tauri::command]
pub fn preview_import(
    state: State<'_, BackupServiceState>,
    path: String,
) -> Result<ImportPreviewDto, AppError> {
    state
        .lock()?
        .preview_import(Path::new(&path))
        .map_err(backup_error)
}

#[tauri::command]
pub fn replace_from_backup(
    state: State<'_, BackupServiceState>,
    path: String,
    preview_token: String,
) -> Result<(), AppError> {
    state
        .lock()?
        .replace_from_backup(Path::new(&path), &preview_token)
        .map_err(backup_error)
}

fn backup_error(error: BackupError) -> AppError {
    match error {
        BackupError::Invalid | BackupError::Io(_) => AppError::BackupInvalid {
            message_key: "errors.backupInvalid",
        },
        BackupError::Repository(_) => AppError::Database {
            message_key: "errors.database",
        },
    }
}
