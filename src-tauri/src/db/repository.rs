use std::collections::HashSet;
use std::fs;

use rusqlite::{Connection, params};

use crate::paths::DataPaths;

use super::RepositoryError;
use super::migrations;
use super::models::{
    GameRecord, GroupRecord, LibrarySnapshot, OverlayDisplayMode, PhraseRecord,
    PhraseVariableRefRecord, SettingRecord, VariableDefinitionRecord, VariablePresetRecord,
};

pub struct Repository {
    connection: Connection,
}

pub struct LibraryTx<'connection> {
    connection: &'connection Connection,
}

impl Repository {
    pub fn open(paths: DataPaths) -> Result<Self, RepositoryError> {
        if let Some(parent) = paths.database.parent() {
            fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(paths.database)?;
        Self::initialize(connection)
    }

    pub fn in_memory() -> Result<Self, RepositoryError> {
        Self::initialize(Connection::open_in_memory()?)
    }

    fn initialize(mut connection: Connection) -> Result<Self, RepositoryError> {
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        migrations::migrate(&mut connection)?;
        Ok(Self { connection })
    }

    pub fn schema_version(&self) -> Result<i64, RepositoryError> {
        migrations::schema_version(&self.connection)
    }

    pub fn applied_migration_versions(&self) -> Result<Vec<i64>, RepositoryError> {
        let mut statement = self
            .connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")?;
        Ok(statement
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn snapshot(&self) -> Result<LibrarySnapshot, RepositoryError> {
        Ok(LibrarySnapshot {
            games: query_games(&self.connection)?,
            groups: query_groups(&self.connection)?,
            phrases: query_phrases(&self.connection)?,
            variable_definitions: query_variable_definitions(&self.connection)?,
            variable_presets: query_variable_presets(&self.connection)?,
            phrase_variable_refs: query_phrase_variable_refs(&self.connection)?,
            settings: query_settings(&self.connection)?,
        })
    }

    pub fn replace_snapshot(&mut self, snapshot: &LibrarySnapshot) -> Result<(), RepositoryError> {
        self.transaction(|tx| tx.replace_snapshot(snapshot))
    }

    pub fn transaction<T, F>(&mut self, operation: F) -> Result<T, RepositoryError>
    where
        F: FnOnce(&mut LibraryTx<'_>) -> Result<T, RepositoryError>,
    {
        self.transaction_with(operation)
    }

    pub fn transaction_with<T, E, F>(&mut self, operation: F) -> Result<T, E>
    where
        E: From<RepositoryError>,
        F: FnOnce(&mut LibraryTx<'_>) -> Result<T, E>,
    {
        let transaction = self
            .connection
            .transaction()
            .map_err(RepositoryError::from)
            .map_err(E::from)?;
        let result = {
            let mut library_tx = LibraryTx {
                connection: &transaction,
            };
            operation(&mut library_tx)
        };

        match result {
            Ok(value) => {
                transaction
                    .commit()
                    .map_err(RepositoryError::from)
                    .map_err(E::from)?;
                Ok(value)
            }
            Err(error) => {
                transaction
                    .rollback()
                    .map_err(RepositoryError::from)
                    .map_err(E::from)?;
                Err(error)
            }
        }
    }
}

impl LibraryTx<'_> {
    pub fn replace_snapshot(&mut self, snapshot: &LibrarySnapshot) -> Result<(), RepositoryError> {
        self.connection
            .execute("DELETE FROM phrase_variable_refs", [])?;
        self.connection
            .execute("DELETE FROM variable_presets", [])?;
        self.connection
            .execute("DELETE FROM variable_definitions", [])?;
        self.connection.execute("DELETE FROM phrases", [])?;
        self.connection.execute("DELETE FROM groups", [])?;
        self.connection.execute("DELETE FROM games", [])?;
        self.connection.execute("DELETE FROM settings", [])?;
        for record in &snapshot.games {
            self.insert_game(record)?;
        }
        for record in &snapshot.groups {
            self.insert_group(record)?;
        }
        for record in &snapshot.phrases {
            self.insert_phrase(record)?;
        }
        for record in &snapshot.variable_definitions {
            self.insert_variable_definition(record)?;
        }
        for record in &snapshot.variable_presets {
            self.insert_variable_preset(record)?;
        }
        for record in &snapshot.phrase_variable_refs {
            self.insert_phrase_variable_ref(record)?;
        }
        for record in &snapshot.settings {
            self.upsert_setting(record)?;
        }
        Ok(())
    }

    pub fn insert_game(&mut self, record: &GameRecord) -> Result<(), RepositoryError> {
        self.connection.execute(
            "INSERT INTO games (id, name, sort_order, overlay_display_mode) VALUES (?1, ?2, ?3, ?4)",
            params![
                record.id,
                record.name,
                record.sort_order,
                record.overlay_display_mode.as_str()
            ],
        )?;
        Ok(())
    }

    pub fn insert_group(&mut self, record: &GroupRecord) -> Result<(), RepositoryError> {
        self.connection.execute(
            "INSERT INTO groups (id, game_id, name, collapsed, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![record.id, record.game_id, record.name, record.collapsed, record.sort_order],
        )?;
        Ok(())
    }

    pub fn insert_phrase(&mut self, record: &PhraseRecord) -> Result<(), RepositoryError> {
        self.connection.execute(
            "INSERT INTO phrases (id, group_id, title, body_template, favorite, favorite_order, hotkey, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                record.id,
                record.group_id,
                record.title,
                record.body_template,
                record.favorite,
                record.favorite_order,
                record.hotkey,
                record.sort_order
            ],
        )?;
        Ok(())
    }

    pub fn insert_variable_definition(
        &mut self,
        record: &VariableDefinitionRecord,
    ) -> Result<(), RepositoryError> {
        self.connection.execute(
            "INSERT INTO variable_definitions (id, game_id, name, normalized_name, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![record.id, record.game_id, record.name, record.normalized_name, record.sort_order],
        )?;
        Ok(())
    }

    pub fn insert_variable_preset(
        &mut self,
        record: &VariablePresetRecord,
    ) -> Result<(), RepositoryError> {
        self.connection.execute(
            "INSERT INTO variable_presets (id, variable_definition_id, value, sort_order) VALUES (?1, ?2, ?3, ?4)",
            params![record.id, record.variable_definition_id, record.value, record.sort_order],
        )?;
        Ok(())
    }

    pub fn insert_phrase_variable_ref(
        &mut self,
        record: &PhraseVariableRefRecord,
    ) -> Result<(), RepositoryError> {
        self.connection.execute(
            "INSERT INTO phrase_variable_refs (phrase_id, variable_definition_id, token_order) VALUES (?1, ?2, ?3)",
            params![record.phrase_id, record.variable_definition_id, record.token_order],
        )?;
        Ok(())
    }

    pub fn upsert_setting(&mut self, record: &SettingRecord) -> Result<(), RepositoryError> {
        self.connection.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![record.key, record.value],
        )?;
        Ok(())
    }

    pub fn delete_game(&mut self, game_id: &str) -> Result<(), RepositoryError> {
        self.connection
            .execute("DELETE FROM games WHERE id = ?1", [game_id])?;
        Ok(())
    }

    pub fn delete_game_with_children(&mut self, game_id: &str) -> Result<(), RepositoryError> {
        self.connection.execute("DELETE FROM phrase_variable_refs WHERE phrase_id IN (SELECT p.id FROM phrases p JOIN groups g ON g.id = p.group_id WHERE g.game_id = ?1)", [game_id])?;
        self.connection.execute("DELETE FROM variable_presets WHERE variable_definition_id IN (SELECT id FROM variable_definitions WHERE game_id = ?1)", [game_id])?;
        self.connection.execute(
            "DELETE FROM variable_definitions WHERE game_id = ?1",
            [game_id],
        )?;
        self.connection.execute(
            "DELETE FROM phrases WHERE group_id IN (SELECT id FROM groups WHERE game_id = ?1)",
            [game_id],
        )?;
        self.connection
            .execute("DELETE FROM groups WHERE game_id = ?1", [game_id])?;
        self.connection
            .execute("DELETE FROM games WHERE id = ?1", [game_id])?;
        Ok(())
    }

    pub fn delete_group_with_children(&mut self, group_id: &str) -> Result<(), RepositoryError> {
        self.connection.execute("DELETE FROM phrase_variable_refs WHERE phrase_id IN (SELECT id FROM phrases WHERE group_id = ?1)", [group_id])?;
        self.connection
            .execute("DELETE FROM phrases WHERE group_id = ?1", [group_id])?;
        self.connection
            .execute("DELETE FROM groups WHERE id = ?1", [group_id])?;
        Ok(())
    }

    pub fn delete_phrase(&mut self, phrase_id: &str) -> Result<(), RepositoryError> {
        self.connection.execute(
            "DELETE FROM phrase_variable_refs WHERE phrase_id = ?1",
            [phrase_id],
        )?;
        self.connection
            .execute("DELETE FROM phrases WHERE id = ?1", [phrase_id])?;
        Ok(())
    }

    pub fn game(&self, game_id: &str) -> Result<Option<GameRecord>, RepositoryError> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, sort_order, overlay_display_mode FROM games WHERE id = ?1",
        )?;
        let mut rows = statement.query([game_id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        Ok(Some(GameRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            sort_order: row.get(2)?,
            overlay_display_mode: read_overlay_display_mode(row, 3)?,
        }))
    }

    pub fn group(&self, group_id: &str) -> Result<Option<GroupRecord>, RepositoryError> {
        let mut statement = self
            .connection
            .prepare("SELECT id, game_id, name, collapsed, sort_order FROM groups WHERE id = ?1")?;
        let mut rows = statement.query([group_id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        Ok(Some(GroupRecord {
            id: row.get(0)?,
            game_id: row.get(1)?,
            name: row.get(2)?,
            collapsed: row.get(3)?,
            sort_order: row.get(4)?,
        }))
    }

    pub fn phrase(&self, phrase_id: &str) -> Result<Option<PhraseRecord>, RepositoryError> {
        let mut statement = self.connection.prepare("SELECT id, group_id, title, body_template, favorite, favorite_order, hotkey, sort_order FROM phrases WHERE id = ?1")?;
        let mut rows = statement.query([phrase_id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        Ok(Some(PhraseRecord {
            id: row.get(0)?,
            group_id: row.get(1)?,
            title: row.get(2)?,
            body_template: row.get(3)?,
            favorite: row.get(4)?,
            favorite_order: row.get(5)?,
            hotkey: row.get(6)?,
            sort_order: row.get(7)?,
        }))
    }

    pub fn update_game(&mut self, record: &GameRecord) -> Result<(), RepositoryError> {
        self.connection.execute(
            "UPDATE games SET name = ?1, sort_order = ?2, overlay_display_mode = ?3 WHERE id = ?4",
            params![
                record.name,
                record.sort_order,
                record.overlay_display_mode.as_str(),
                record.id
            ],
        )?;
        Ok(())
    }

    pub fn update_group(&mut self, record: &GroupRecord) -> Result<(), RepositoryError> {
        self.connection.execute("UPDATE groups SET game_id = ?1, name = ?2, collapsed = ?3, sort_order = ?4 WHERE id = ?5", params![record.game_id, record.name, record.collapsed, record.sort_order, record.id])?;
        Ok(())
    }

    pub fn update_phrase(&mut self, record: &PhraseRecord) -> Result<(), RepositoryError> {
        self.connection.execute("UPDATE phrases SET group_id = ?1, title = ?2, body_template = ?3, favorite = ?4, favorite_order = ?5, hotkey = ?6, sort_order = ?7 WHERE id = ?8", params![record.group_id, record.title, record.body_template, record.favorite, record.favorite_order, record.hotkey, record.sort_order, record.id])?;
        Ok(())
    }

    pub fn reorder_games(&mut self, ordered_ids: &[String]) -> Result<(), RepositoryError> {
        let stored_ids = query_games(self.connection)?
            .into_iter()
            .map(|game| game.id)
            .collect::<Vec<_>>();
        validate_complete_order(&stored_ids, ordered_ids)?;
        let offset = ordered_ids.len() as i64;
        self.connection
            .execute("UPDATE games SET sort_order = sort_order + ?1", [offset])?;
        for (index, id) in ordered_ids.iter().enumerate() {
            self.connection.execute(
                "UPDATE games SET sort_order = ?1 WHERE id = ?2",
                params![index as i64, id],
            )?;
        }
        Ok(())
    }

    pub fn reorder_groups(
        &mut self,
        game_id: &str,
        ordered_ids: &[String],
    ) -> Result<(), RepositoryError> {
        let stored_ids = query_groups(self.connection)?
            .into_iter()
            .filter(|group| group.game_id == game_id)
            .map(|group| group.id)
            .collect::<Vec<_>>();
        validate_complete_order(&stored_ids, ordered_ids)?;
        let offset = ordered_ids.len() as i64;
        self.connection.execute(
            "UPDATE groups SET sort_order = sort_order + ?1 WHERE game_id = ?2",
            params![offset, game_id],
        )?;
        for (index, id) in ordered_ids.iter().enumerate() {
            self.connection.execute(
                "UPDATE groups SET sort_order = ?1 WHERE id = ?2 AND game_id = ?3",
                params![index as i64, id, game_id],
            )?;
        }
        Ok(())
    }

    pub fn reorder_variable_definitions(
        &mut self,
        game_id: &str,
        ordered_ids: &[String],
    ) -> Result<(), RepositoryError> {
        let stored_ids = self
            .variable_definitions_for_game(game_id)?
            .into_iter()
            .map(|definition| definition.id)
            .collect::<Vec<_>>();
        validate_complete_order(&stored_ids, ordered_ids)?;
        let offset = ordered_ids.len() as i64;
        self.connection.execute(
            "UPDATE variable_definitions SET sort_order = sort_order + ?1 WHERE game_id = ?2",
            params![offset, game_id],
        )?;
        for (index, id) in ordered_ids.iter().enumerate() {
            self.connection.execute(
                "UPDATE variable_definitions SET sort_order = ?1 WHERE id = ?2 AND game_id = ?3",
                params![index as i64, id, game_id],
            )?;
        }
        Ok(())
    }

    pub fn move_phrase(
        &mut self,
        phrase_id: &str,
        target_group_id: &str,
        target_index: usize,
    ) -> Result<(), RepositoryError> {
        let phrase = self
            .phrase(phrase_id)?
            .ok_or(RepositoryError::InvalidSiblingOrder)?;
        let mut source_ids = sibling_phrase_ids(self.connection, &phrase.group_id)?;
        source_ids.sort_by_key(|id| {
            self.phrase(id)
                .ok()
                .flatten()
                .map(|record| record.sort_order)
        });
        let mut target_ids = if phrase.group_id == target_group_id {
            source_ids.clone()
        } else {
            let mut ids = sibling_phrase_ids(self.connection, target_group_id)?;
            ids.sort_by_key(|id| {
                self.phrase(id)
                    .ok()
                    .flatten()
                    .map(|record| record.sort_order)
            });
            ids
        };
        if target_index > target_ids.len() || self.group(target_group_id)?.is_none() {
            return Err(RepositoryError::InvalidSiblingOrder);
        }
        if phrase.group_id == target_group_id {
            target_ids.retain(|id| id != phrase_id);
            if target_index > target_ids.len() {
                return Err(RepositoryError::InvalidSiblingOrder);
            }
            target_ids.insert(target_index, phrase_id.to_owned());
            return self.reorder_phrases(target_group_id, &target_ids);
        }
        source_ids.retain(|id| id != phrase_id);
        let temporary_order: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM phrases WHERE group_id = ?1",
            [target_group_id],
            |row| row.get(0),
        )?;
        self.connection.execute(
            "UPDATE phrases SET group_id = ?1, sort_order = ?2 WHERE id = ?3",
            params![target_group_id, temporary_order, phrase_id],
        )?;
        self.reorder_phrases(&phrase.group_id, &source_ids)?;
        target_ids.insert(target_index, phrase_id.to_owned());
        self.reorder_phrases(target_group_id, &target_ids)
    }

    pub fn reorder_favorites(
        &mut self,
        game_id: &str,
        ordered_ids: &[String],
    ) -> Result<(), RepositoryError> {
        let stored_ids = self
            .phrases_for_game(game_id)?
            .into_iter()
            .filter(|phrase| phrase.favorite)
            .map(|phrase| phrase.id)
            .collect::<Vec<_>>();
        validate_complete_order(&stored_ids, ordered_ids)?;
        for (index, id) in ordered_ids.iter().enumerate() {
            self.connection.execute(
                "UPDATE phrases SET favorite_order = ?1 WHERE id = ?2",
                params![index as i64, id],
            )?;
        }
        Ok(())
    }

    pub fn reorder_phrases(
        &mut self,
        group_id: &str,
        ordered_ids: &[String],
    ) -> Result<(), RepositoryError> {
        let stored_ids = sibling_phrase_ids(self.connection, group_id)?;
        validate_complete_order(&stored_ids, ordered_ids)?;

        let temporary_start: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM phrases WHERE group_id = ?1",
            [group_id],
            |row| row.get(0),
        )?;
        let temporary_end = temporary_start
            .checked_add(ordered_ids.len() as i64)
            .ok_or(RepositoryError::SortOrderOverflow)?;
        if temporary_end < temporary_start {
            return Err(RepositoryError::SortOrderOverflow);
        }

        // Move all siblings above the current maximum first so the unique index
        // cannot collide while two records exchange positions.
        for (temporary_order, phrase_id) in ordered_ids.iter().enumerate() {
            self.connection.execute(
                "UPDATE phrases SET sort_order = ?1 WHERE id = ?2 AND group_id = ?3",
                params![
                    temporary_start + temporary_order as i64,
                    phrase_id,
                    group_id
                ],
            )?;
        }
        for (sort_order, phrase_id) in ordered_ids.iter().enumerate() {
            self.connection.execute(
                "UPDATE phrases SET sort_order = ?1 WHERE id = ?2 AND group_id = ?3",
                params![sort_order as i64, phrase_id, group_id],
            )?;
        }
        Ok(())
    }

    pub fn variable_definition(
        &self,
        definition_id: &str,
    ) -> Result<Option<VariableDefinitionRecord>, RepositoryError> {
        let mut statement = self.connection.prepare(
            "SELECT id, game_id, name, normalized_name, sort_order FROM variable_definitions WHERE id = ?1",
        )?;
        let mut rows = statement.query([definition_id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        Ok(Some(VariableDefinitionRecord {
            id: row.get(0)?,
            game_id: row.get(1)?,
            name: row.get(2)?,
            normalized_name: row.get(3)?,
            sort_order: row.get(4)?,
        }))
    }

    pub fn variable_definitions_for_game(
        &self,
        game_id: &str,
    ) -> Result<Vec<VariableDefinitionRecord>, RepositoryError> {
        let mut statement = self.connection.prepare(
            "SELECT id, game_id, name, normalized_name, sort_order FROM variable_definitions WHERE game_id = ?1 ORDER BY sort_order, id",
        )?;
        Ok(statement
            .query_map([game_id], |row| {
                Ok(VariableDefinitionRecord {
                    id: row.get(0)?,
                    game_id: row.get(1)?,
                    name: row.get(2)?,
                    normalized_name: row.get(3)?,
                    sort_order: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn phrases_for_game(&self, game_id: &str) -> Result<Vec<PhraseRecord>, RepositoryError> {
        let mut statement = self.connection.prepare(
            "SELECT p.id, p.group_id, p.title, p.body_template, p.favorite, p.favorite_order, p.hotkey, p.sort_order FROM phrases p INNER JOIN groups g ON g.id = p.group_id WHERE g.game_id = ?1 ORDER BY g.sort_order, p.sort_order, p.id",
        )?;
        Ok(statement
            .query_map([game_id], |row| {
                Ok(PhraseRecord {
                    id: row.get(0)?,
                    group_id: row.get(1)?,
                    title: row.get(2)?,
                    body_template: row.get(3)?,
                    favorite: row.get(4)?,
                    favorite_order: row.get(5)?,
                    hotkey: row.get(6)?,
                    sort_order: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn update_phrase_body(
        &mut self,
        phrase_id: &str,
        body_template: &str,
    ) -> Result<(), RepositoryError> {
        self.connection.execute(
            "UPDATE phrases SET body_template = ?1 WHERE id = ?2",
            params![body_template, phrase_id],
        )?;
        Ok(())
    }

    pub fn update_variable_definition(
        &mut self,
        record: &VariableDefinitionRecord,
    ) -> Result<(), RepositoryError> {
        self.connection.execute(
            "UPDATE variable_definitions SET game_id = ?1, name = ?2, normalized_name = ?3, sort_order = ?4 WHERE id = ?5",
            params![
                record.game_id,
                record.name,
                record.normalized_name,
                record.sort_order,
                record.id
            ],
        )?;
        Ok(())
    }

    pub fn replace_phrase_variable_refs(
        &mut self,
        phrase_id: &str,
        references: &[PhraseVariableRefRecord],
    ) -> Result<(), RepositoryError> {
        self.connection.execute(
            "DELETE FROM phrase_variable_refs WHERE phrase_id = ?1",
            [phrase_id],
        )?;
        for reference in references {
            self.insert_phrase_variable_ref(reference)?;
        }
        Ok(())
    }

    pub fn replace_variable_presets(
        &mut self,
        definition_id: &str,
        presets: &[VariablePresetRecord],
    ) -> Result<(), RepositoryError> {
        self.connection.execute(
            "DELETE FROM variable_presets WHERE variable_definition_id = ?1",
            [definition_id],
        )?;
        for preset in presets {
            self.insert_variable_preset(preset)?;
        }
        Ok(())
    }

    pub fn delete_variable_definition(
        &mut self,
        definition_id: &str,
    ) -> Result<(), RepositoryError> {
        self.connection.execute(
            "DELETE FROM variable_presets WHERE variable_definition_id = ?1",
            [definition_id],
        )?;
        self.connection.execute(
            "DELETE FROM phrase_variable_refs WHERE variable_definition_id = ?1",
            [definition_id],
        )?;
        self.connection.execute(
            "DELETE FROM variable_definitions WHERE id = ?1",
            [definition_id],
        )?;
        Ok(())
    }

    pub fn reorder_variable_presets(
        &mut self,
        definition_id: &str,
        ordered_ids: &[String],
    ) -> Result<(), RepositoryError> {
        let mut statement = self
            .connection
            .prepare("SELECT id FROM variable_presets WHERE variable_definition_id = ?1")?;
        let stored_ids = statement
            .query_map([definition_id], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        drop(statement);
        validate_complete_order(&stored_ids, ordered_ids)?;

        let temporary_start: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM variable_presets WHERE variable_definition_id = ?1",
            [definition_id],
            |row| row.get(0),
        )?;
        let temporary_end = temporary_start
            .checked_add(ordered_ids.len() as i64)
            .ok_or(RepositoryError::SortOrderOverflow)?;
        if temporary_end < temporary_start {
            return Err(RepositoryError::SortOrderOverflow);
        }

        for (temporary_order, preset_id) in ordered_ids.iter().enumerate() {
            self.connection.execute(
                "UPDATE variable_presets SET sort_order = ?1 WHERE id = ?2 AND variable_definition_id = ?3",
                params![temporary_start + temporary_order as i64, preset_id, definition_id],
            )?;
        }
        for (sort_order, preset_id) in ordered_ids.iter().enumerate() {
            self.connection.execute(
                "UPDATE variable_presets SET sort_order = ?1 WHERE id = ?2 AND variable_definition_id = ?3",
                params![sort_order as i64, preset_id, definition_id],
            )?;
        }
        Ok(())
    }
}

fn validate_complete_order(
    stored_ids: &[String],
    ordered_ids: &[String],
) -> Result<(), RepositoryError> {
    let requested: HashSet<&str> = ordered_ids.iter().map(String::as_str).collect();
    let stored: HashSet<&str> = stored_ids.iter().map(String::as_str).collect();
    if requested.len() != ordered_ids.len()
        || stored_ids.len() != ordered_ids.len()
        || requested != stored
    {
        return Err(RepositoryError::InvalidSiblingOrder);
    }
    Ok(())
}

fn sibling_phrase_ids(
    connection: &Connection,
    group_id: &str,
) -> Result<Vec<String>, RepositoryError> {
    let mut statement = connection.prepare("SELECT id FROM phrases WHERE group_id = ?1")?;
    Ok(statement
        .query_map([group_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?)
}

fn query_games(connection: &Connection) -> Result<Vec<GameRecord>, RepositoryError> {
    let mut statement = connection.prepare(
        "SELECT id, name, sort_order, overlay_display_mode FROM games ORDER BY sort_order, id",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok(GameRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                overlay_display_mode: read_overlay_display_mode(row, 3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn read_overlay_display_mode(
    row: &rusqlite::Row<'_>,
    column: usize,
) -> rusqlite::Result<OverlayDisplayMode> {
    let value: String = row.get(column)?;
    OverlayDisplayMode::from_database(&value).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(InvalidOverlayDisplayMode),
        )
    })
}

#[derive(Debug)]
struct InvalidOverlayDisplayMode;

impl std::fmt::Display for InvalidOverlayDisplayMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("invalid overlay display mode in database")
    }
}

impl std::error::Error for InvalidOverlayDisplayMode {}

fn query_groups(connection: &Connection) -> Result<Vec<GroupRecord>, RepositoryError> {
    let mut statement = connection.prepare(
        "SELECT id, game_id, name, collapsed, sort_order FROM groups ORDER BY game_id, sort_order, id",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok(GroupRecord {
                id: row.get(0)?,
                game_id: row.get(1)?,
                name: row.get(2)?,
                collapsed: row.get(3)?,
                sort_order: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn query_phrases(connection: &Connection) -> Result<Vec<PhraseRecord>, RepositoryError> {
    let mut statement = connection.prepare(
        "SELECT id, group_id, title, body_template, favorite, favorite_order, hotkey, sort_order FROM phrases ORDER BY group_id, sort_order, id",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok(PhraseRecord {
                id: row.get(0)?,
                group_id: row.get(1)?,
                title: row.get(2)?,
                body_template: row.get(3)?,
                favorite: row.get(4)?,
                favorite_order: row.get(5)?,
                hotkey: row.get(6)?,
                sort_order: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn query_variable_definitions(
    connection: &Connection,
) -> Result<Vec<VariableDefinitionRecord>, RepositoryError> {
    let mut statement = connection.prepare(
        "SELECT id, game_id, name, normalized_name, sort_order FROM variable_definitions ORDER BY game_id, sort_order, id",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok(VariableDefinitionRecord {
                id: row.get(0)?,
                game_id: row.get(1)?,
                name: row.get(2)?,
                normalized_name: row.get(3)?,
                sort_order: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn query_variable_presets(
    connection: &Connection,
) -> Result<Vec<VariablePresetRecord>, RepositoryError> {
    let mut statement = connection.prepare(
        "SELECT id, variable_definition_id, value, sort_order FROM variable_presets ORDER BY variable_definition_id, sort_order, id",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok(VariablePresetRecord {
                id: row.get(0)?,
                variable_definition_id: row.get(1)?,
                value: row.get(2)?,
                sort_order: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn query_phrase_variable_refs(
    connection: &Connection,
) -> Result<Vec<PhraseVariableRefRecord>, RepositoryError> {
    let mut statement = connection.prepare(
        "SELECT phrase_id, variable_definition_id, token_order FROM phrase_variable_refs ORDER BY phrase_id, token_order",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok(PhraseVariableRefRecord {
                phrase_id: row.get(0)?,
                variable_definition_id: row.get(1)?,
                token_order: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn query_settings(connection: &Connection) -> Result<Vec<SettingRecord>, RepositoryError> {
    let mut statement = connection.prepare("SELECT key, value FROM settings ORDER BY key")?;
    Ok(statement
        .query_map([], |row| {
            Ok(SettingRecord {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}
