use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::db::Repository;
use crate::error::AppError;
use crate::services::clipboard::{
    ClipboardError, ClipboardPort, ClipboardService, ClipboardServiceError, CopySuccessDto,
};
use crate::services::session::RecentCopyDto;

struct TauriClipboardPort {
    app: AppHandle,
}

impl ClipboardPort for TauriClipboardPort {
    fn write_text(&self, text: &str) -> Result<(), ClipboardError> {
        self.app
            .clipboard()
            .write_text(text)
            .map_err(|_| ClipboardError::Unavailable)
    }
}

pub struct ClipboardServiceState(Mutex<ClipboardService>);

impl ClipboardServiceState {
    pub fn new(repository: Repository, app: AppHandle) -> Self {
        Self(Mutex::new(ClipboardService::new(
            repository,
            TauriClipboardPort { app },
        )))
    }

    fn lock(&self) -> Result<MutexGuard<'_, ClipboardService>, AppError> {
        self.0.lock().map_err(|_| AppError::Internal {
            message_key: "errors.internal",
        })
    }

    pub fn copy_plain_shortcut(&self, phrase_id: &str) -> Result<CopySuccessDto, AppError> {
        self.lock()?
            .copy_phrase(phrase_id, &HashMap::new())
            .map_err(command_error_for_copy)
    }
}

#[tauri::command]
pub fn copy_phrase(
    state: State<'_, ClipboardServiceState>,
    phrase_id: String,
    variables: HashMap<String, String>,
) -> Result<CopySuccessDto, AppError> {
    state
        .lock()?
        .copy_phrase(&phrase_id, &variables)
        .map_err(command_error_for_copy)
}

#[tauri::command]
pub fn get_recent_copies(
    state: State<'_, ClipboardServiceState>,
) -> Result<Vec<RecentCopyDto>, AppError> {
    Ok(state.lock()?.get_recent_copies())
}

pub fn command_error_for_copy(error: ClipboardServiceError) -> AppError {
    match error {
        ClipboardServiceError::NotFound => AppError::NotFound {
            message_key: "errors.notFound",
        },
        ClipboardServiceError::InvalidTemplate => AppError::Validation {
            message_key: "errors.validation",
        },
        ClipboardServiceError::ClipboardBusy => AppError::ClipboardBusy {
            message_key: "errors.clipboardBusy",
        },
        ClipboardServiceError::Repository(_) => AppError::Database {
            message_key: "errors.database",
        },
    }
}
