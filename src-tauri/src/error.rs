use std::collections::BTreeMap;

use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandErrorCode {
    Validation,
    NotFound,
    ShortcutConflict,
    ClipboardBusy,
    BackupInvalid,
    Database,
    Update,
    Internal,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandErrorDto {
    pub code: CommandErrorCode,
    pub message_key: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("validation error")]
    Validation { message_key: &'static str },
    #[error("not found")]
    NotFound { message_key: &'static str },
    #[error("shortcut conflict")]
    ShortcutConflict { message_key: &'static str },
    #[error("clipboard busy")]
    ClipboardBusy { message_key: &'static str },
    #[error("invalid backup")]
    BackupInvalid { message_key: &'static str },
    #[error("database error")]
    Database { message_key: &'static str },
    #[error("update error")]
    Update { message_key: &'static str },
    #[error("internal error")]
    Internal { message_key: &'static str },
}

impl AppError {
    pub fn validation(message_key: &'static str, _user_phrase: &str) -> Self {
        Self::Validation { message_key }
    }

    fn command_error(&self) -> CommandErrorDto {
        let (code, message_key) = match self {
            Self::Validation { message_key } => (CommandErrorCode::Validation, *message_key),
            Self::NotFound { message_key } => (CommandErrorCode::NotFound, *message_key),
            Self::ShortcutConflict { message_key } => {
                (CommandErrorCode::ShortcutConflict, *message_key)
            }
            Self::ClipboardBusy { message_key } => (CommandErrorCode::ClipboardBusy, *message_key),
            Self::BackupInvalid { message_key } => (CommandErrorCode::BackupInvalid, *message_key),
            Self::Database { message_key } => (CommandErrorCode::Database, *message_key),
            Self::Update { message_key } => (CommandErrorCode::Update, *message_key),
            Self::Internal { message_key } => (CommandErrorCode::Internal, *message_key),
        };

        CommandErrorDto {
            code,
            message_key,
            details: None,
        }
    }
}

impl From<AppError> for CommandErrorDto {
    fn from(error: AppError) -> Self {
        error.command_error()
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.command_error().serialize(serializer)
    }
}
