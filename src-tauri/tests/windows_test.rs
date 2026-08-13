use std::fs;
use std::path::PathBuf;

use partypaste_lib::services::windows::{
    Bounds, LifecycleEffect, LifecycleEvent, Monitor, OVERLAY_TOPMOST_KEY, WindowKind,
    clamp_bounds, default_overlay_topmost, lifecycle_effects, minimum_physical_size,
    recovery_adjustment, tray_action,
};

#[test]
fn windows_close_requests_hide_each_window_and_keep_the_process_alive() {
    assert_eq!(
        lifecycle_effects(LifecycleEvent::CloseRequested(WindowKind::Overlay)),
        vec![LifecycleEffect::Hide(WindowKind::Overlay)]
    );
    assert_eq!(
        lifecycle_effects(LifecycleEvent::CloseRequested(WindowKind::Manager)),
        vec![LifecycleEffect::Hide(WindowKind::Manager)]
    );
}

#[test]
fn windows_explicit_quit_is_the_only_lifecycle_action_that_exits() {
    assert_eq!(
        lifecycle_effects(LifecycleEvent::ExplicitQuit),
        vec![LifecycleEffect::Exit]
    );
}

#[test]
fn windows_second_instance_restores_and_focuses_the_manager() {
    assert_eq!(
        lifecycle_effects(LifecycleEvent::SecondInstance),
        vec![
            LifecycleEffect::Show(WindowKind::Manager),
            LifecycleEffect::Unminimize(WindowKind::Manager),
            LifecycleEffect::Focus(WindowKind::Manager),
        ]
    );
}

#[test]
fn windows_tray_actions_map_to_the_visible_lifecycle_contract() {
    assert_eq!(
        tray_action("show_overlay"),
        Some(LifecycleEvent::ShowOverlay)
    );
    assert_eq!(
        tray_action("hide_overlay"),
        Some(LifecycleEvent::HideOverlay)
    );
    assert_eq!(
        tray_action("open_manager"),
        Some(LifecycleEvent::OpenManager)
    );
    assert_eq!(
        tray_action("check_updates"),
        Some(LifecycleEvent::CheckForUpdates)
    );
    assert_eq!(tray_action("quit"), Some(LifecycleEvent::ExplicitQuit));
    assert_eq!(tray_action("unknown"), None);
}

#[test]
fn windows_topmost_change_applies_only_to_the_overlay_and_persists_the_preference() {
    assert!(default_overlay_topmost());
    assert!(OVERLAY_TOPMOST_KEY.starts_with("window_"));
    assert_eq!(
        lifecycle_effects(LifecycleEvent::SetOverlayTopmost(true)),
        vec![
            LifecycleEffect::SetTopmost(WindowKind::Overlay, true),
            LifecycleEffect::PersistTopmost(true),
        ]
    );
}

#[test]
fn windows_overlay_shortcut_toggles_visibility_in_both_directions() {
    assert_eq!(
        lifecycle_effects(LifecycleEvent::ToggleOverlay { visible: true }),
        vec![LifecycleEffect::Hide(WindowKind::Overlay)]
    );
    assert_eq!(
        lifecycle_effects(LifecycleEvent::ToggleOverlay { visible: false }),
        vec![
            LifecycleEffect::Show(WindowKind::Overlay),
            LifecycleEffect::Focus(WindowKind::Overlay),
        ]
    );
}

#[test]
fn windows_template_shortcut_always_shows_and_focuses_the_overlay() {
    assert_eq!(
        lifecycle_effects(LifecycleEvent::ShowOverlay),
        vec![
            LifecycleEffect::Show(WindowKind::Overlay),
            LifecycleEffect::Focus(WindowKind::Overlay),
        ]
    );
}

#[test]
fn windows_saved_bounds_are_fully_clamped_after_a_monitor_is_removed() {
    let monitors = [Monitor {
        work_area: Bounds {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        },
    }];
    let recovered = clamp_bounds(
        Bounds {
            x: 2400,
            y: 100,
            width: 1120,
            height: 720,
        },
        &monitors,
        (760, 560),
    );

    assert_eq!(
        recovered,
        Bounds {
            x: 800,
            y: 100,
            width: 1120,
            height: 720,
        }
    );
}

#[test]
fn windows_saved_bounds_remain_meaningfully_visible_when_dpi_or_work_area_shrinks() {
    let monitors = [Monitor {
        work_area: Bounds {
            x: -1280,
            y: 0,
            width: 1280,
            height: 680,
        },
    }];
    let recovered = clamp_bounds(
        Bounds {
            x: -1700,
            y: -400,
            width: 1600,
            height: 900,
        },
        &monitors,
        (760, 560),
    );

    assert_eq!(
        recovered,
        Bounds {
            x: -1280,
            y: 0,
            width: 1280,
            height: 680,
        }
    );
}

#[test]
fn windows_runtime_recovery_reclamps_after_dpi_and_monitor_changes_then_becomes_a_no_op() {
    let remaining_monitor = [Monitor {
        work_area: Bounds {
            x: 0,
            y: 0,
            width: 1280,
            height: 720,
        },
    }];
    let minimum = minimum_physical_size(WindowKind::Overlay, 1.5);
    assert_eq!(minimum, (360, 240));

    let recovered = recovery_adjustment(
        Bounds {
            x: 1800,
            y: 90,
            width: 450,
            height: 630,
        },
        &remaining_monitor,
        minimum,
    );
    assert_eq!(
        recovered,
        Some(Bounds {
            x: 830,
            y: 90,
            width: 450,
            height: 630,
        })
    );
    assert_eq!(
        recovery_adjustment(recovered.unwrap(), &remaining_monitor, minimum),
        None
    );
}

#[test]
fn windows_runtime_recovery_does_nothing_for_already_visible_bounds() {
    let monitor = [Monitor {
        work_area: Bounds {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1040,
        },
    }];
    assert_eq!(
        recovery_adjustment(
            Bounds {
                x: -1200,
                y: 100,
                width: 1120,
                height: 720,
            },
            &monitor,
            minimum_physical_size(WindowKind::Manager, 1.0),
        ),
        None
    );
}

#[test]
fn windows_defaults_and_minimums_match_the_desktop_contract() {
    assert_eq!(WindowKind::Overlay.default_size(), (300, 420));
    assert_eq!(WindowKind::Overlay.minimum_size(), (240, 160));
    assert_eq!(WindowKind::Manager.default_size(), (1120, 720));
    assert_eq!(WindowKind::Manager.minimum_size(), (760, 560));
}

#[test]
fn windows_capability_files_keep_backup_and_update_installation_out_of_the_overlay() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let overlay = fs::read_to_string(root.join("capabilities/overlay.json")).unwrap();
    let manager = fs::read_to_string(root.join("capabilities/manager.json")).unwrap();
    let permissions = fs::read_to_string(root.join("permissions/windows.toml")).unwrap();

    for forbidden in [
        "export_backup",
        "preview_import",
        "replace_from_backup",
        "dialog:allow-open",
        "dialog:allow-save",
        "updater:allow-download-and-install",
        "updater:allow-install",
    ] {
        assert!(!overlay.contains(forbidden), "overlay exposed {forbidden}");
    }
    assert!(overlay.contains("overlay-window-commands"));
    assert!(permissions.contains("commands.allow = [\"get_window_settings\", \"toggle_topmost\"]"));
    for required in [
        "export_backup",
        "preview_import",
        "replace_from_backup",
        "dialog:allow-open",
        "dialog:allow-save",
    ] {
        assert!(
            manager.contains(required) || permissions.contains(required),
            "manager omitted {required}"
        );
    }
    assert!(!manager.contains("updater:allow-install"));
    assert!(!manager.contains("updater:allow-download-and-install"));
}

#[test]
fn windows_no_fixed_tray_guid_is_configured_before_signing() {
    let source = fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/services/windows.rs"),
    )
    .unwrap();
    assert!(!source.contains("TrayIconBuilder::with_id"));
    assert!(!source.contains("tray.set_id"));
}
