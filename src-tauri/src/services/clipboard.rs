use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use thiserror::Error;

use crate::db::{Repository, RepositoryError};

use super::session::{RecentCopyDto, SessionStore};
use super::templates::TemplateService;

const RETRY_DELAYS: [Duration; 2] = [Duration::from_millis(50), Duration::from_millis(100)];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClipboardError {
    Unavailable,
}

pub trait ClipboardPort: Send {
    fn write_text(&self, text: &str) -> Result<(), ClipboardError>;
}

pub trait RetryDelay: Send {
    fn wait(&self, duration: Duration);
}

pub trait SessionClock: Send {
    fn now_millis(&self) -> u64;
}

struct NativeRetryDelay;

impl RetryDelay for NativeRetryDelay {
    fn wait(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

struct SystemClock;

impl SessionClock for SystemClock {
    fn now_millis(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX)
    }
}

pub type CopySuccessDto = RecentCopyDto;

#[derive(Debug, Error)]
pub enum ClipboardServiceError {
    #[error("phrase not found")]
    NotFound,
    #[error("phrase template is invalid or incomplete")]
    InvalidTemplate,
    #[error("clipboard is unavailable")]
    ClipboardBusy,
    #[error("database operation failed")]
    Repository(#[from] RepositoryError),
}

pub struct ClipboardService {
    repository: Repository,
    clipboard: Box<dyn ClipboardPort>,
    delay: Box<dyn RetryDelay>,
    clock: Box<dyn SessionClock>,
    session: SessionStore,
}

impl ClipboardService {
    pub fn new(repository: Repository, clipboard: impl ClipboardPort + 'static) -> Self {
        Self::with_runtime(repository, clipboard, NativeRetryDelay, SystemClock)
    }

    pub fn with_runtime(
        repository: Repository,
        clipboard: impl ClipboardPort + 'static,
        delay: impl RetryDelay + 'static,
        clock: impl SessionClock + 'static,
    ) -> Self {
        Self {
            repository,
            clipboard: Box::new(clipboard),
            delay: Box::new(delay),
            clock: Box::new(clock),
            session: SessionStore::new(),
        }
    }

    pub fn copy_phrase(
        &mut self,
        phrase_id: &str,
        variables: &HashMap<String, String>,
    ) -> Result<CopySuccessDto, ClipboardServiceError> {
        let phrase = self
            .repository
            .snapshot()?
            .phrases
            .into_iter()
            .find(|phrase| phrase.id == phrase_id)
            .ok_or(ClipboardServiceError::NotFound)?;
        let scan = TemplateService::scan(&phrase.body_template);
        if !scan.issues.is_empty() {
            return Err(ClipboardServiceError::InvalidTemplate);
        }
        let resolved_text = TemplateService::resolve(&scan.tokens, variables)
            .map_err(|_| ClipboardServiceError::InvalidTemplate)?;

        for retry_delay in RETRY_DELAYS.into_iter().map(Some).chain([None]) {
            match self.clipboard.write_text(&resolved_text) {
                Ok(()) => {
                    let recent = RecentCopyDto {
                        phrase_id: phrase.id,
                        title: phrase.title,
                        resolved_at: self.clock.now_millis(),
                        resolved_text,
                    };
                    self.session.add_recent_copy(recent.clone());
                    return Ok(recent);
                }
                Err(_) => match retry_delay {
                    Some(duration) => self.delay.wait(duration),
                    None => return Err(ClipboardServiceError::ClipboardBusy),
                },
            }
        }

        unreachable!("three clipboard attempts always return")
    }

    pub fn get_recent_copies(&self) -> Vec<RecentCopyDto> {
        self.session.recent_copies()
    }
}
