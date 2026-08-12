use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

const RECENT_COPY_LIMIT: usize = 30;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentCopyDto {
    pub phrase_id: String,
    pub title: String,
    pub resolved_at: u64,
    pub resolved_text: String,
}

#[derive(Default)]
pub struct SessionStore {
    recent_copies: VecDeque<RecentCopyDto>,
}

impl SessionStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_recent_copy(&mut self, copy: RecentCopyDto) {
        self.recent_copies.push_front(copy);
        self.recent_copies.truncate(RECENT_COPY_LIMIT);
    }

    pub fn recent_copies(&self) -> Vec<RecentCopyDto> {
        self.recent_copies.iter().cloned().collect()
    }
}
