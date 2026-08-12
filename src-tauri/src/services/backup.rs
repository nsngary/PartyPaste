use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;

use crate::db::models::{LibrarySnapshot, PhraseVariableRefRecord};
use crate::db::{BACKUP_SCHEMA_VERSION, Repository, RepositoryError};
use crate::paths::DataPaths;

use super::library::LibraryMutationHook;
use super::templates::{TemplateService, TemplateToken};

pub const MAX_BACKUP_BYTES: u64 = 10 * 1024 * 1024;
const PREVIEW_VALIDITY_MS: u64 = 5 * 60 * 1000;
const SAFETY_BACKUP_LIMIT: usize = 5;
static BACKUP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupDocumentV1 {
    pub schema_version: u8,
    pub library: LibrarySnapshot,
}

impl BackupDocumentV1 {
    pub fn from_snapshot(snapshot: &LibrarySnapshot) -> Self {
        let mut library = snapshot.clone();
        library
            .settings
            .retain(|setting| is_backup_setting(&setting.key));
        Self {
            schema_version: BACKUP_SCHEMA_VERSION,
            library,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewDto {
    pub preview_token: String,
    pub expires_at: u64,
    pub game_count: usize,
    pub group_count: usize,
    pub phrase_count: usize,
    pub variable_definition_count: usize,
    pub variable_preset_count: usize,
    pub phrase_variable_ref_count: usize,
    pub shortcut_conflict_count: usize,
}

#[derive(Debug, Error)]
pub enum BackupError {
    #[error("backup is invalid")]
    Invalid,
    #[error("backup storage failed")]
    Io(#[from] std::io::Error),
    #[error("backup database operation failed")]
    Repository(#[from] RepositoryError),
}

struct PendingPreview {
    canonical_path: PathBuf,
    fingerprint: String,
    expires_at: u64,
}

enum VersionedBackupDocument {
    V1(BackupDocumentV1),
}

pub struct BackupService {
    repository: Repository,
    paths: DataPaths,
    previews: HashMap<String, PendingPreview>,
    clock: Box<dyn Fn() -> u64 + Send + Sync>,
    mutation_hook: Box<dyn LibraryMutationHook>,
}

struct NoopMutationHook;

impl LibraryMutationHook for NoopMutationHook {
    fn library_changed(&mut self, _snapshot: &LibrarySnapshot) {}
}

impl BackupService {
    pub fn new(repository: Repository, paths: DataPaths) -> Self {
        Self::with_clock(repository, paths, now_millis)
    }

    pub fn with_mutation_hook(
        repository: Repository,
        paths: DataPaths,
        mutation_hook: impl LibraryMutationHook + 'static,
    ) -> Self {
        let mut service = Self::with_clock(repository, paths, now_millis);
        service.mutation_hook = Box::new(mutation_hook);
        service
    }

    pub fn with_clock(
        repository: Repository,
        paths: DataPaths,
        clock: impl Fn() -> u64 + Send + Sync + 'static,
    ) -> Self {
        Self {
            repository,
            paths,
            previews: HashMap::new(),
            clock: Box::new(clock),
            mutation_hook: Box::new(NoopMutationHook),
        }
    }

    pub fn snapshot(&self) -> Result<LibrarySnapshot, BackupError> {
        Ok(self.repository.snapshot()?)
    }

    pub fn export_backup(&self, path: &Path) -> Result<(), BackupError> {
        let document = BackupDocumentV1::from_snapshot(&self.repository.snapshot()?);
        write_document_atomically(path, &document)
    }

    pub fn preview_import(&mut self, path: &Path) -> Result<ImportPreviewDto, BackupError> {
        let validated = self.read_validated(path)?;
        let now = (self.clock)();
        self.previews.retain(|_, preview| preview.expires_at > now);
        let sequence = BACKUP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let preview_token = format!("{}-{sequence:016x}", validated.fingerprint);
        let expires_at = now.saturating_add(PREVIEW_VALIDITY_MS);
        self.previews.insert(
            preview_token.clone(),
            PendingPreview {
                canonical_path: validated.canonical_path,
                fingerprint: validated.fingerprint,
                expires_at,
            },
        );
        Ok(ImportPreviewDto {
            preview_token,
            expires_at,
            game_count: validated.document.library.games.len(),
            group_count: validated.document.library.groups.len(),
            phrase_count: validated.document.library.phrases.len(),
            variable_definition_count: validated.document.library.variable_definitions.len(),
            variable_preset_count: validated.document.library.variable_presets.len(),
            phrase_variable_ref_count: validated.document.library.phrase_variable_refs.len(),
            shortcut_conflict_count: shortcut_conflict_count(&validated.document.library),
        })
    }

    pub fn replace_from_backup(
        &mut self,
        path: &Path,
        preview_token: &str,
    ) -> Result<(), BackupError> {
        let now = (self.clock)();
        let Some(pending) = self.previews.remove(preview_token) else {
            return Err(BackupError::Invalid);
        };
        if pending.expires_at <= now {
            return Err(BackupError::Invalid);
        }
        let validated = self.read_validated(path)?;
        if validated.canonical_path != pending.canonical_path
            || validated.fingerprint != pending.fingerprint
        {
            return Err(BackupError::Invalid);
        }

        let safety_document = BackupDocumentV1::from_snapshot(&self.repository.snapshot()?);
        self.write_safety_backup(&safety_document)?;
        self.repository
            .replace_snapshot(&validated.document.library)?;
        self.mutation_hook
            .library_changed(&validated.document.library);
        Ok(())
    }

    fn read_validated(&self, path: &Path) -> Result<ValidatedDocument, BackupError> {
        let metadata = fs::metadata(path)?;
        if metadata.len() > MAX_BACKUP_BYTES {
            return Err(BackupError::Invalid);
        }
        let bytes = fs::read(path)?;
        if bytes.len() as u64 > MAX_BACKUP_BYTES {
            return Err(BackupError::Invalid);
        }
        let document = parse_versioned_document(&bytes)?;
        validate_snapshot(&document.library)?;
        let canonical_path = fs::canonicalize(path)?;
        Ok(ValidatedDocument {
            fingerprint: fingerprint(&canonical_path, &bytes),
            canonical_path,
            document,
        })
    }

    fn write_safety_backup(&self, document: &BackupDocumentV1) -> Result<(), BackupError> {
        fs::create_dir_all(&self.paths.backups)?;
        let sequence = BACKUP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let name = format!("pre-import-{:020}-{sequence:016}.json", (self.clock)());
        write_document_atomically(&self.paths.backups.join(name), document)?;
        retain_safety_backups(&self.paths.backups)
    }
}

struct ValidatedDocument {
    document: BackupDocumentV1,
    canonical_path: PathBuf,
    fingerprint: String,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}

fn write_document_atomically(path: &Path, document: &BackupDocumentV1) -> Result<(), BackupError> {
    let bytes = serde_json::to_vec(document).map_err(|_| BackupError::Invalid)?;
    let parent = path.parent().ok_or(BackupError::Invalid)?;
    fs::create_dir_all(parent)?;
    if path.exists() {
        return Err(BackupError::Invalid);
    }
    let temporary = path.with_extension(format!(
        "{}.tmp",
        BACKUP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| -> Result<(), std::io::Error> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(BackupError::Io)
}

fn retain_safety_backups(directory: &Path) -> Result<(), BackupError> {
    let mut backups = fs::read_dir(directory)?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_ok_and(|kind| kind.is_file())
                && entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("pre-import-")
                && entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "json")
        })
        .collect::<Vec<_>>();
    backups.sort_by_key(|entry| entry.file_name());
    let expired = backups.len().saturating_sub(SAFETY_BACKUP_LIMIT);
    for entry in backups.into_iter().take(expired) {
        fs::remove_file(entry.path())?;
    }
    Ok(())
}

fn fingerprint(path: &Path, bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_os_str().to_string_lossy().as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn is_backup_setting(key: &str) -> bool {
    let normalized = key.nfkc().case_fold().collect::<String>();
    !["machine_", "recent_", "window_"]
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionProbe {
    schema_version: u8,
}

fn parse_versioned_document(bytes: &[u8]) -> Result<BackupDocumentV1, BackupError> {
    let version: VersionProbe = serde_json::from_slice(bytes).map_err(|_| BackupError::Invalid)?;
    let document = match version.schema_version {
        BACKUP_SCHEMA_VERSION => VersionedBackupDocument::V1(
            serde_json::from_slice(bytes).map_err(|_| BackupError::Invalid)?,
        ),
        _ => return Err(BackupError::Invalid),
    };
    match document {
        VersionedBackupDocument::V1(document) => Ok(document),
    }
}

fn validate_snapshot(snapshot: &LibrarySnapshot) -> Result<(), BackupError> {
    if snapshot
        .settings
        .iter()
        .any(|setting| !is_backup_setting(&setting.key))
    {
        return Err(BackupError::Invalid);
    }
    validate_unique(snapshot.games.iter().map(|record| record.id.as_str()))?;
    validate_unique(snapshot.groups.iter().map(|record| record.id.as_str()))?;
    validate_unique(snapshot.phrases.iter().map(|record| record.id.as_str()))?;
    validate_unique(
        snapshot
            .variable_definitions
            .iter()
            .map(|record| record.id.as_str()),
    )?;
    validate_unique(
        snapshot
            .variable_presets
            .iter()
            .map(|record| record.id.as_str()),
    )?;
    validate_unique(snapshot.settings.iter().map(|record| record.key.as_str()))?;
    validate_orders(snapshot.games.iter().map(|record| ("", record.sort_order)))?;

    let game_ids = snapshot
        .games
        .iter()
        .map(|record| record.id.as_str())
        .collect::<HashSet<_>>();
    let groups = snapshot
        .groups
        .iter()
        .map(|record| (record.id.as_str(), record))
        .collect::<HashMap<_, _>>();
    for group in &snapshot.groups {
        if !game_ids.contains(group.game_id.as_str()) {
            return Err(BackupError::Invalid);
        }
    }
    validate_orders(
        snapshot
            .groups
            .iter()
            .map(|record| (record.game_id.as_str(), record.sort_order)),
    )?;

    for phrase in &snapshot.phrases {
        if !groups.contains_key(phrase.group_id.as_str())
            || (!phrase.favorite && phrase.favorite_order.is_some())
            || (phrase.favorite && phrase.favorite_order.is_none())
        {
            return Err(BackupError::Invalid);
        }
    }
    validate_orders(
        snapshot
            .phrases
            .iter()
            .map(|record| (record.group_id.as_str(), record.sort_order)),
    )?;
    let phrase_game = snapshot
        .phrases
        .iter()
        .map(|phrase| {
            let game_id = groups[phrase.group_id.as_str()].game_id.as_str();
            (phrase.id.as_str(), game_id)
        })
        .collect::<HashMap<_, _>>();
    validate_orders(
        snapshot
            .phrases
            .iter()
            .filter(|phrase| phrase.favorite)
            .map(|phrase| {
                (
                    phrase_game[phrase.id.as_str()],
                    phrase.favorite_order.unwrap_or_default(),
                )
            }),
    )?;

    let definitions = snapshot
        .variable_definitions
        .iter()
        .map(|record| (record.id.as_str(), record))
        .collect::<HashMap<_, _>>();
    for definition in &snapshot.variable_definitions {
        if !game_ids.contains(definition.game_id.as_str())
            || definition.normalized_name != normalize_name(&definition.name)
        {
            return Err(BackupError::Invalid);
        }
    }
    validate_orders(
        snapshot
            .variable_definitions
            .iter()
            .map(|record| (record.game_id.as_str(), record.sort_order)),
    )?;
    let mut normalized_names = HashSet::new();
    for definition in &snapshot.variable_definitions {
        if !normalized_names.insert((
            definition.game_id.as_str(),
            definition.normalized_name.as_str(),
        )) {
            return Err(BackupError::Invalid);
        }
    }

    for preset in &snapshot.variable_presets {
        if !definitions.contains_key(preset.variable_definition_id.as_str()) {
            return Err(BackupError::Invalid);
        }
    }
    validate_orders(
        snapshot
            .variable_presets
            .iter()
            .map(|record| (record.variable_definition_id.as_str(), record.sort_order)),
    )?;
    validate_phrase_references(snapshot, &phrase_game, &definitions)
}

fn validate_unique<'a>(values: impl Iterator<Item = &'a str>) -> Result<(), BackupError> {
    let mut seen = HashSet::new();
    for value in values {
        if value.is_empty() || !seen.insert(value) {
            return Err(BackupError::Invalid);
        }
    }
    Ok(())
}

fn validate_orders<'a>(values: impl Iterator<Item = (&'a str, i64)>) -> Result<(), BackupError> {
    let mut per_parent = HashMap::<&str, Vec<i64>>::new();
    for (parent, sort_order) in values {
        if sort_order < 0 {
            return Err(BackupError::Invalid);
        }
        per_parent.entry(parent).or_default().push(sort_order);
    }
    for mut orders in per_parent.into_values() {
        orders.sort_unstable();
        if orders
            .iter()
            .enumerate()
            .any(|(index, order)| *order != index as i64)
        {
            return Err(BackupError::Invalid);
        }
    }
    Ok(())
}

fn validate_phrase_references(
    snapshot: &LibrarySnapshot,
    phrase_game: &HashMap<&str, &str>,
    definitions: &HashMap<&str, &crate::db::models::VariableDefinitionRecord>,
) -> Result<(), BackupError> {
    let names = snapshot
        .variable_definitions
        .iter()
        .map(|definition| {
            (
                (
                    definition.game_id.as_str(),
                    definition.normalized_name.as_str(),
                ),
                definition.id.as_str(),
            )
        })
        .collect::<HashMap<_, _>>();
    let expected = snapshot
        .phrases
        .iter()
        .flat_map(|phrase| {
            let game_id = phrase_game[phrase.id.as_str()];
            let scan = TemplateService::scan(&phrase.body_template);
            if !scan.issues.is_empty() {
                return Vec::new();
            }
            scan.tokens
                .iter()
                .filter_map(|token| match token {
                    TemplateToken::Variable { name } => Some(name),
                    TemplateToken::Text { .. } => None,
                })
                .enumerate()
                .filter_map(|(token_order, name)| {
                    names
                        .get(&(game_id, normalize_name(name).as_str()))
                        .map(|definition_id| PhraseVariableRefRecord {
                            phrase_id: phrase.id.clone(),
                            variable_definition_id: (*definition_id).to_owned(),
                            token_order: token_order as i64,
                        })
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    if snapshot.phrases.iter().any(|phrase| {
        !TemplateService::scan(&phrase.body_template)
            .issues
            .is_empty()
    }) {
        return Err(BackupError::Invalid);
    }
    let actual = snapshot
        .phrase_variable_refs
        .iter()
        .map(|reference| {
            let Some(game_id) = phrase_game.get(reference.phrase_id.as_str()) else {
                return Err(BackupError::Invalid);
            };
            let Some(definition) = definitions.get(reference.variable_definition_id.as_str())
            else {
                return Err(BackupError::Invalid);
            };
            if definition.game_id != *game_id || reference.token_order < 0 {
                return Err(BackupError::Invalid);
            }
            Ok((
                reference.phrase_id.as_str(),
                reference.variable_definition_id.as_str(),
                reference.token_order,
            ))
        })
        .collect::<Result<HashSet<_>, _>>()?;
    let expected = expected
        .iter()
        .map(|reference| {
            (
                reference.phrase_id.as_str(),
                reference.variable_definition_id.as_str(),
                reference.token_order,
            )
        })
        .collect::<HashSet<_>>();
    if actual.len() != snapshot.phrase_variable_refs.len() || actual != expected {
        return Err(BackupError::Invalid);
    }
    Ok(())
}

fn normalize_name(name: &str) -> String {
    name.trim().nfkc().case_fold().collect()
}

fn shortcut_conflict_count(snapshot: &LibrarySnapshot) -> usize {
    let mut bindings = HashSet::new();
    let mut conflicts = 0;
    for shortcut in snapshot
        .settings
        .iter()
        .filter(|setting| setting.key == "overlay_shortcut")
        .map(|setting| setting.value.as_str())
        .chain(
            snapshot
                .phrases
                .iter()
                .filter_map(|phrase| phrase.hotkey.as_deref()),
        )
    {
        let normalized = crate::services::shortcuts::normalize_shortcut(shortcut);
        let has_modifier = normalized
            .split('+')
            .any(|part| matches!(part, "Ctrl" | "Alt" | "Shift" | "Meta"));
        if !has_modifier || !bindings.insert(normalized) {
            conflicts += 1;
        }
    }
    conflicts
}
