use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};

use super::RepositoryError;

const INITIAL_SCHEMA: &str = include_str!("../../migrations/0001_initial.sql");

pub(crate) const BACKUP_SCHEMA_VERSION: u8 = 1;

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![M::up(INITIAL_SCHEMA)])
}

pub(super) fn migrate(connection: &mut Connection) -> Result<(), RepositoryError> {
    migrations().to_latest(connection)?;
    Ok(())
}

pub(super) fn schema_version(connection: &Connection) -> Result<i64, RepositoryError> {
    Ok(connection.pragma_query_value(None, "user_version", |row| row.get(0))?)
}

#[cfg(test)]
mod tests {
    use super::migrations;

    #[test]
    fn migrations_are_valid() {
        migrations().validate().expect("valid migration sequence");
    }
}
