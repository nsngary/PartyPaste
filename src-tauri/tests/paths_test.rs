use std::path::Path;

use partypaste_lib::{error::AppError, paths::resolve_data_paths};

#[test]
fn resolve_data_paths_uses_executable_data_directory_only_for_portable_mode() {
    let exe = Path::new("C:/PartyPaste/PartyPaste.exe");
    let app_data = Path::new("C:/Users/Ada/AppData/Roaming/PartyPaste");

    let portable = resolve_data_paths(exe, app_data, true);
    assert!(portable.portable);
    assert_eq!(
        portable.database,
        Path::new("C:/PartyPaste/data/partypaste.db")
    );
    assert_eq!(portable.backups, Path::new("C:/PartyPaste/data/backups"));
    assert_eq!(portable.logs, Path::new("C:/PartyPaste/data/logs"));

    let installed = resolve_data_paths(exe, app_data, false);
    assert!(!installed.portable);
    assert_eq!(
        installed.database,
        Path::new("C:/Users/Ada/AppData/Roaming/PartyPaste/partypaste.db")
    );
    assert_eq!(
        installed.backups,
        Path::new("C:/Users/Ada/AppData/Roaming/PartyPaste/backups")
    );
    assert_eq!(
        installed.logs,
        Path::new("C:/Users/Ada/AppData/Roaming/PartyPaste/logs")
    );
}

#[test]
fn command_errors_do_not_serialize_user_phrase_text() {
    let phrase = "secret phrase owned by a user";
    let error = AppError::validation("errors.validation", phrase);
    let serialized = serde_json::to_string(&error).expect("serializes command error");

    assert!(!serialized.contains(phrase));
    assert_eq!(
        serialized,
        r#"{"code":"validation","messageKey":"errors.validation"}"#
    );
}
