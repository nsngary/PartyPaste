pub mod commands;
pub mod db;
pub mod error;
pub mod paths;
pub mod services;

use tauri::Manager;

use commands::library::RepositoryState;
use db::Repository;
use paths::resolve_data_paths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let executable = std::env::current_exe()?;
            let app_data = app.path().app_data_dir()?;
            let portable = executable
                .parent()
                .is_some_and(|directory| directory.join("partypaste.portable").exists());
            let repository =
                Repository::open(resolve_data_paths(&executable, &app_data, portable))?;
            app.manage(RepositoryState::new(repository));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library::list_variable_definitions,
            commands::library::save_variable_definition,
            commands::library::reorder_variable_presets,
            commands::library::delete_variable_definition,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PartyPaste");
}
