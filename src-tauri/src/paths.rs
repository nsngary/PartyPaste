use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataPaths {
    pub database: PathBuf,
    pub backups: PathBuf,
    pub logs: PathBuf,
    pub portable: bool,
}

pub fn resolve_data_paths(exe: &Path, app_data: &Path, marker_exists: bool) -> DataPaths {
    let data_root = if marker_exists {
        exe.parent().unwrap_or(exe).join("data")
    } else {
        app_data.to_path_buf()
    };

    DataPaths {
        database: data_root.join("partypaste.db"),
        backups: data_root.join("backups"),
        logs: data_root.join("logs"),
        portable: marker_exists,
    }
}
