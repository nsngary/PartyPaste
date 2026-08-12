use std::collections::HashMap;

use serde::Serialize;
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

use crate::db::models::LibrarySnapshot;

const DEFAULT_OVERLAY_SHORTCUT: &str = "Ctrl+Shift+Space";
const OVERLAY_SHORTCUT_KEY: &str = "overlay_shortcut";
const MODIFIER_ORDER: [&str; 4] = ["Ctrl", "Alt", "Shift", "Meta"];

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ShortcutAction {
    Overlay,
    Phrase(String),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ShortcutEvent {
    CopyPhrase {
        phrase_id: String,
    },
    ShowOverlay {
        open_template_phrase_id: Option<String>,
    },
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutsDto {
    pub overlay: String,
    pub phrases: HashMap<String, String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RebuildResult {
    pub conflicts: Vec<ShortcutAction>,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ShortcutError {
    #[error("shortcut needs a modifier")]
    ModifierRequired,
    #[error("shortcut duplicates a PartyPaste binding")]
    Duplicate,
    #[error("shortcut registration was rejected")]
    RegistrationRejected,
}

pub trait ShortcutPort: Send {
    fn register(&self, accelerator: &str) -> Result<(), ShortcutError>;
    fn unregister(&self, accelerator: &str) -> Result<(), ShortcutError>;
}

#[derive(Clone)]
struct RegisteredShortcut {
    accelerator: String,
    event: ShortcutEvent,
}

pub struct ShortcutRegistry {
    port: Box<dyn ShortcutPort>,
    registered: HashMap<ShortcutAction, RegisteredShortcut>,
}

impl ShortcutRegistry {
    pub fn new(port: impl ShortcutPort + 'static) -> Self {
        Self {
            port: Box::new(port),
            registered: HashMap::new(),
        }
    }

    pub fn replace(
        &mut self,
        action: ShortcutAction,
        shortcut: &str,
    ) -> Result<String, ShortcutError> {
        let accelerator = normalize_shortcut(shortcut);
        validate_shortcut(&accelerator)?;
        if self.registered.iter().any(|(candidate, registered)| {
            candidate != &action && registered.accelerator == accelerator
        }) {
            return Err(ShortcutError::Duplicate);
        }

        let previous = self.registered.get(&action).cloned();
        if let Some(previous) = &previous {
            self.port.unregister(&previous.accelerator)?;
        }
        if let Err(error) = self.port.register(&accelerator) {
            if let Some(previous) = previous {
                let _ = self.port.register(&previous.accelerator);
            }
            return Err(error);
        }
        self.registered.insert(
            action.clone(),
            RegisteredShortcut {
                accelerator: accelerator.clone(),
                event: event_for_action(&action, false),
            },
        );
        Ok(accelerator)
    }

    pub fn remove(&mut self, action: &ShortcutAction) -> Result<(), ShortcutError> {
        if let Some(previous) = self.registered.get(action).cloned() {
            self.port.unregister(&previous.accelerator)?;
            self.registered.remove(action);
        }
        Ok(())
    }

    pub fn set_phrase_template(&mut self, phrase_id: &str, template: bool) {
        let action = ShortcutAction::Phrase(phrase_id.to_owned());
        if let Some(registered) = self.registered.get_mut(&action) {
            registered.event = event_for_action(&action, template);
        }
    }

    pub fn rebuild(&mut self, snapshot: &LibrarySnapshot) -> RebuildResult {
        self.shutdown();
        let mut result = RebuildResult::default();
        let overlay = snapshot
            .settings
            .iter()
            .find(|setting| setting.key == OVERLAY_SHORTCUT_KEY)
            .map(|setting| setting.value.as_str())
            .unwrap_or(DEFAULT_OVERLAY_SHORTCUT);
        self.register_during_rebuild(ShortcutAction::Overlay, overlay, false, &mut result);
        for phrase in &snapshot.phrases {
            let Some(shortcut) = phrase.hotkey.as_deref() else {
                continue;
            };
            let template = crate::services::templates::TemplateService::scan(&phrase.body_template)
                .tokens
                .iter()
                .any(|token| {
                    matches!(
                        token,
                        crate::services::templates::TemplateToken::Variable { .. }
                    )
                });
            self.register_during_rebuild(
                ShortcutAction::Phrase(phrase.id.clone()),
                shortcut,
                template,
                &mut result,
            );
        }
        result
    }

    pub fn event_for(&self, shortcut: &str) -> Option<ShortcutEvent> {
        let shortcut = normalize_shortcut(shortcut);
        self.registered
            .values()
            .find(|registered| registered.accelerator == shortcut)
            .map(|registered| registered.event.clone())
    }

    pub fn shortcuts(&self) -> ShortcutsDto {
        let mut shortcuts = ShortcutsDto {
            overlay: DEFAULT_OVERLAY_SHORTCUT.into(),
            phrases: HashMap::new(),
        };
        for (action, registered) in &self.registered {
            match action {
                ShortcutAction::Overlay => shortcuts.overlay = registered.accelerator.clone(),
                ShortcutAction::Phrase(phrase_id) => {
                    shortcuts
                        .phrases
                        .insert(phrase_id.clone(), registered.accelerator.clone());
                }
            }
        }
        shortcuts
    }

    pub fn shutdown(&mut self) {
        for registered in self.registered.drain().map(|(_, registered)| registered) {
            let _ = self.port.unregister(&registered.accelerator);
        }
    }

    fn register_during_rebuild(
        &mut self,
        action: ShortcutAction,
        shortcut: &str,
        template: bool,
        result: &mut RebuildResult,
    ) {
        let accelerator = normalize_shortcut(shortcut);
        if validate_shortcut(&accelerator).is_err()
            || self
                .registered
                .values()
                .any(|registered| registered.accelerator == accelerator)
            || self.port.register(&accelerator).is_err()
        {
            result.conflicts.push(action);
            return;
        }
        self.registered.insert(
            action.clone(),
            RegisteredShortcut {
                accelerator,
                event: event_for_action(&action, template),
            },
        );
    }
}

impl Drop for ShortcutRegistry {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn event_for_action(action: &ShortcutAction, template: bool) -> ShortcutEvent {
    match action {
        ShortcutAction::Overlay => ShortcutEvent::ShowOverlay {
            open_template_phrase_id: None,
        },
        ShortcutAction::Phrase(phrase_id) if template => ShortcutEvent::ShowOverlay {
            open_template_phrase_id: Some(phrase_id.clone()),
        },
        ShortcutAction::Phrase(phrase_id) => ShortcutEvent::CopyPhrase {
            phrase_id: phrase_id.clone(),
        },
    }
}

pub fn normalize_shortcut(shortcut: &str) -> String {
    let mut modifiers = Vec::new();
    let mut keys = Vec::new();
    for part in shortcut.nfkc().collect::<String>().split('+') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => modifiers.push("Ctrl"),
            "alt" | "option" => modifiers.push("Alt"),
            "shift" => modifiers.push("Shift"),
            "meta" | "super" | "win" => modifiers.push("Meta"),
            "space" => keys.push("Space".into()),
            "enter" => keys.push("Enter".into()),
            "esc" | "escape" => keys.push("Escape".into()),
            "tab" => keys.push("Tab".into()),
            _ if part.chars().count() == 1 => keys.push(part.to_uppercase()),
            _ => keys.push(part.to_owned()),
        }
    }
    modifiers.sort_by_key(|modifier| {
        MODIFIER_ORDER
            .iter()
            .position(|candidate| candidate == modifier)
            .unwrap_or(MODIFIER_ORDER.len())
    });
    modifiers.dedup();
    modifiers
        .into_iter()
        .map(str::to_owned)
        .chain(keys)
        .collect::<Vec<_>>()
        .join("+")
}

fn validate_shortcut(accelerator: &str) -> Result<(), ShortcutError> {
    if accelerator
        .split('+')
        .all(|part| !MODIFIER_ORDER.contains(&part))
    {
        return Err(ShortcutError::ModifierRequired);
    }
    Ok(())
}
