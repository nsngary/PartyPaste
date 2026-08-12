mod migrations;
pub mod models;
mod repository;

use thiserror::Error;

pub(crate) use migrations::BACKUP_SCHEMA_VERSION;
pub use models::LibrarySnapshot;
pub use repository::{LibraryTx, Repository};

#[derive(Debug, Error)]
pub enum RepositoryError {
    #[error("database operation failed")]
    Sql(#[from] rusqlite::Error),
    #[error("database migration failed")]
    Migration(#[from] rusqlite_migration::Error),
    #[error("database path operation failed")]
    Io(#[from] std::io::Error),
    #[error("ordered record identifiers must contain every sibling exactly once")]
    InvalidSiblingOrder,
    #[error("sort order exceeds the supported integer range")]
    SortOrderOverflow,
}
