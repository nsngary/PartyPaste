use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::commands::clipboard::ClipboardServiceState;
use crate::db::models::SettingRecord;
use crate::db::{Repository, RepositoryError};
use crate::error::AppError;
use crate::services::shortcuts::{
    OVERLAY_SHORTCUT_KEY, ShortcutAction, ShortcutError, ShortcutEvent, ShortcutMutationError,
    ShortcutPort, ShortcutRegistryHandle, ShortcutsDto, effective_overlay_shortcut,
};
use crate::services::templates::{TemplateService, TemplateToken};

pub struct TauriShortcutPort {
    app: AppHandle,
}

impl TauriShortcutPort {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl ShortcutPort for TauriShortcutPort {
    fn register(&self, accelerator: &str) -> Result<(), ShortcutError> {
        self.app
            .global_shortcut()
            .on_shortcut(accelerator, |app, shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    route_shortcut(app, &shortcut.to_string());
                }
            })
            .map_err(|_| ShortcutError::RegistrationRejected)
    }

    fn unregister(&self, accelerator: &str) -> Result<(), ShortcutError> {
        self.app
            .global_shortcut()
            .unregister(accelerator)
            .map_err(|_| ShortcutError::RegistrationRejected)
    }
}

pub struct ShortcutSettingsState(Mutex<ShortcutSettingsService>);

pub struct ShortcutSettingsService {
    repository: Repository,
    registry: ShortcutRegistryHandle,
}

impl ShortcutSettingsService {
    fn configured_shortcuts(&self) -> Result<ShortcutsDto, RepositoryError> {
        let snapshot = self.repository.snapshot()?;
        let overlay = effective_overlay_shortcut(&snapshot).to_owned();
        let phrases = snapshot
            .phrases
            .into_iter()
            .filter_map(|phrase| phrase.hotkey.map(|shortcut| (phrase.id, shortcut)))
            .collect();
        Ok(ShortcutsDto { overlay, phrases })
    }
}

impl ShortcutSettingsState {
    pub fn new(
        repository: Repository,
        port: impl ShortcutPort + 'static,
    ) -> Result<Self, RepositoryError> {
        let registry = ShortcutRegistryHandle::new(port);
        registry.rebuild(&repository.snapshot()?);
        Ok(Self(Mutex::new(ShortcutSettingsService {
            repository,
            registry,
        })))
    }

    fn lock(&self) -> Result<MutexGuard<'_, ShortcutSettingsService>, AppError> {
        self.0.lock().map_err(|_| AppError::Internal {
            message_key: "errors.internal",
        })
    }

    pub fn event_for(&self, accelerator: &str) -> Option<ShortcutEvent> {
        self.0
            .lock()
            .ok()
            .and_then(|service| service.registry.event_for(accelerator))
    }

    pub fn shutdown(&self) {
        if let Ok(service) = self.0.lock() {
            service.registry.shutdown();
        }
    }

    pub fn mutation_hook(&self) -> ShortcutRegistryHandle {
        self.0
            .lock()
            .expect("shortcut settings mutex poisoned")
            .registry
            .clone()
    }
}

impl Drop for ShortcutSettingsState {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[tauri::command]
pub fn get_shortcuts(state: State<'_, ShortcutSettingsState>) -> Result<ShortcutsDto, AppError> {
    state
        .lock()?
        .configured_shortcuts()
        .map_err(repository_error)
}

#[tauri::command]
pub fn set_overlay_shortcut(
    state: State<'_, ShortcutSettingsState>,
    shortcut: String,
) -> Result<ShortcutsDto, AppError> {
    let mut service = state.lock()?;
    let registry = service.registry.clone();
    registry
        .replace_transactional(ShortcutAction::Overlay, &shortcut, false, |accelerator| {
            service.repository.transaction(|tx| {
                tx.upsert_setting(&SettingRecord {
                    key: OVERLAY_SHORTCUT_KEY.into(),
                    value: accelerator.to_owned(),
                })
            })
        })
        .map_err(shortcut_mutation_error)?;
    Ok(registry.shortcuts())
}

#[tauri::command]
pub fn set_phrase_shortcut(
    state: State<'_, ShortcutSettingsState>,
    phrase_id: String,
    shortcut: Option<String>,
) -> Result<ShortcutsDto, AppError> {
    let mut service = state.lock()?;
    let mut phrase = service
        .repository
        .snapshot()
        .map_err(repository_error)?
        .phrases
        .into_iter()
        .find(|phrase| phrase.id == phrase_id)
        .ok_or(AppError::NotFound {
            message_key: "errors.notFound",
        })?;
    let action = ShortcutAction::Phrase(phrase_id);
    let registry = service.registry.clone();
    if let Some(shortcut) = shortcut {
        let template = TemplateService::scan(&phrase.body_template)
            .tokens
            .iter()
            .any(|token| matches!(token, TemplateToken::Variable { .. }));
        registry
            .replace_transactional(action, &shortcut, template, |accelerator| {
                phrase.hotkey = Some(accelerator.to_owned());
                service
                    .repository
                    .transaction(|tx| tx.update_phrase(&phrase))
            })
            .map_err(shortcut_mutation_error)?;
    } else {
        registry
            .remove_transactional(&action, || {
                phrase.hotkey = None;
                service
                    .repository
                    .transaction(|tx| tx.update_phrase(&phrase))
            })
            .map_err(shortcut_mutation_error)?;
    }
    Ok(registry.shortcuts())
}

pub fn route_shortcut(app: &AppHandle, accelerator: &str) {
    let Some(state) = app.try_state::<ShortcutSettingsState>() else {
        return;
    };
    let Some(event) = state.event_for(accelerator) else {
        return;
    };
    match &event {
        ShortcutEvent::CopyPhrase { phrase_id } => {
            let copied = app
                .try_state::<ClipboardServiceState>()
                .is_some_and(|clipboard| clipboard.copy_plain_shortcut(phrase_id).is_ok());
            if !copied {
                let _ = app.emit_to(
                    "overlay",
                    "shortcut-action",
                    ShortcutEvent::CopyPhraseFailed {
                        phrase_id: phrase_id.clone(),
                    },
                );
                return;
            }
        }
        ShortcutEvent::CopyPhraseFailed { .. } => return,
        ShortcutEvent::ShowOverlay { .. } => {
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.show();
                let _ = overlay.set_focus();
            }
        }
    }
    let _ = app.emit_to("overlay", "shortcut-action", event);
}

fn shortcut_error(error: ShortcutError) -> AppError {
    match error {
        ShortcutError::ModifierRequired | ShortcutError::Duplicate => AppError::Validation {
            message_key: "errors.validation",
        },
        ShortcutError::RegistrationRejected => AppError::ShortcutConflict {
            message_key: "errors.shortcutConflict",
        },
    }
}

fn shortcut_mutation_error(error: ShortcutMutationError<RepositoryError>) -> AppError {
    match error {
        ShortcutMutationError::Shortcut(error) | ShortcutMutationError::Rollback(error) => {
            shortcut_error(error)
        }
        ShortcutMutationError::Persistence(error) => repository_error(error),
    }
}

fn repository_error(_: RepositoryError) -> AppError {
    AppError::Database {
        message_key: "errors.database",
    }
}
