pub mod commands;
pub mod db;
pub mod error;
pub mod paths;
pub mod services;

use tauri::Manager;

use commands::backup::BackupServiceState;
use commands::clipboard::ClipboardServiceState;
use commands::library::LibraryServiceState;
use commands::settings::{ShortcutSettingsState, TauriShortcutPort};
use db::Repository;
use paths::resolve_data_paths;
use services::backup::BackupService;
use services::windows::{self, WindowServiceState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::apply_lifecycle(app, windows::LifecycleEvent::SecondInstance);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let executable = std::env::current_exe()?;
            let app_data = app.path().app_data_dir()?;
            let portable = executable
                .parent()
                .is_some_and(|directory| directory.join("partypaste.portable").exists());
            let paths = resolve_data_paths(&executable, &app_data, portable);
            let repository = Repository::open(paths.clone())?;
            let clipboard_repository = Repository::open(paths.clone())?;
            let shortcut_repository = Repository::open(paths.clone())?;
            let shortcut_state = ShortcutSettingsState::new(
                shortcut_repository,
                TauriShortcutPort::new(app.handle().clone()),
            )?;
            let shortcut_hook = shortcut_state.mutation_hook();
            let backup_repository = Repository::open(paths.clone())?;
            let window_repository = Repository::open(paths.clone())?;
            let window_state = WindowServiceState::new(window_repository);
            let window_settings = window_state.settings()?;
            app.manage(LibraryServiceState::with_mutation_hook(
                repository,
                shortcut_hook.clone(),
            ));
            app.manage(ClipboardServiceState::new(
                clipboard_repository,
                app.handle().clone(),
            ));
            app.manage(shortcut_state);
            app.manage(BackupServiceState::new(BackupService::with_mutation_hook(
                backup_repository,
                paths,
                shortcut_hook,
            )));
            app.manage(window_state);
            windows::install_window_lifecycle(app)?;
            windows::schedule_bounds_recovery(app);
            if let Some(overlay) = app.get_webview_window("overlay") {
                overlay.set_always_on_top(window_settings.always_on_top)?;
            }
            app.manage(windows::create_tray(app)?);
            Ok(())
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::clipboard::copy_phrase,
            commands::clipboard::get_recent_copies,
            commands::backup::export_backup,
            commands::backup::preview_import,
            commands::backup::replace_from_backup,
            commands::settings::get_shortcuts,
            commands::settings::set_overlay_shortcut,
            commands::settings::set_phrase_shortcut,
            windows::show_overlay,
            windows::hide_overlay,
            windows::open_manager,
            windows::get_window_settings,
            windows::toggle_topmost,
            windows::quit_app,
            commands::library::get_library,
            commands::library::create_game,
            commands::library::update_game,
            commands::library::set_overlay_display_mode,
            commands::library::delete_game,
            commands::library::create_group,
            commands::library::update_group,
            commands::library::set_group_collapsed,
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
