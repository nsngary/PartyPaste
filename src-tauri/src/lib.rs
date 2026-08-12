pub mod commands;
pub mod db;
pub mod error;
pub mod paths;
pub mod services;

use tauri::Manager;

use commands::library::LibraryServiceState;
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
            app.manage(LibraryServiceState::new(repository));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library::get_library,
            commands::library::create_game,
            commands::library::update_game,
            commands::library::delete_game,
            commands::library::create_group,
            commands::library::update_group,
            commands::library::delete_group,
            commands::library::create_phrase,
            commands::library::update_phrase,
            commands::library::delete_phrase,
            commands::library::duplicate_phrase,
            commands::library::move_phrase,
            commands::library::reorder_games,
            commands::library::reorder_groups,
            commands::library::reorder_phrases,
            commands::library::reorder_favorites,
            commands::library::reorder_variable_definitions,
            commands::library::set_favorite,
            commands::library::search_phrases,
            commands::library::undo_operation,
            commands::library::get_game_delete_impact,
            commands::library::get_group_delete_impact,
            commands::library::list_variable_definitions,
            commands::library::save_variable_definition,
            commands::library::reorder_variable_presets,
            commands::library::delete_variable_definition,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PartyPaste");
}
