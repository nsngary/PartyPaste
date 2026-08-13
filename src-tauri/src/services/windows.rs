use std::sync::{
    Arc, Mutex, MutexGuard,
    atomic::{AtomicBool, Ordering},
};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{
    App, AppHandle, Emitter, Listener, Manager, PhysicalPosition, PhysicalSize, Runtime, State,
    WebviewWindow, WindowEvent,
};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use crate::db::Repository;
use crate::db::models::SettingRecord;
use crate::error::AppError;

pub const OVERLAY_TOPMOST_KEY: &str = "window_overlay_always_on_top";

pub const fn default_overlay_topmost() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WindowKind {
    Overlay,
    Manager,
}

impl WindowKind {
    pub const fn label(self) -> &'static str {
        match self {
            Self::Overlay => "overlay",
            Self::Manager => "manager",
        }
    }

    pub const fn default_size(self) -> (u32, u32) {
        match self {
            Self::Overlay => (300, 420),
            Self::Manager => (1120, 720),
        }
    }

    pub const fn minimum_size(self) -> (u32, u32) {
        match self {
            Self::Overlay => (240, 160),
            Self::Manager => (760, 560),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LifecycleEvent {
    CloseRequested(WindowKind),
    ShowOverlay,
    HideOverlay,
    ToggleOverlay { visible: bool },
    OpenManager,
    CheckForUpdates,
    SecondInstance,
    SetOverlayTopmost(bool),
    ExplicitQuit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LifecycleEffect {
    Show(WindowKind),
    Hide(WindowKind),
    Unminimize(WindowKind),
    Focus(WindowKind),
    EmitUpdateCheck,
    SetTopmost(WindowKind, bool),
    PersistTopmost(bool),
    Exit,
}

pub fn lifecycle_effects(event: LifecycleEvent) -> Vec<LifecycleEffect> {
    match event {
        LifecycleEvent::CloseRequested(window) => vec![LifecycleEffect::Hide(window)],
        LifecycleEvent::ShowOverlay => vec![
            LifecycleEffect::Show(WindowKind::Overlay),
            LifecycleEffect::Focus(WindowKind::Overlay),
        ],
        LifecycleEvent::HideOverlay => vec![LifecycleEffect::Hide(WindowKind::Overlay)],
        LifecycleEvent::ToggleOverlay { visible: true } => {
            vec![LifecycleEffect::Hide(WindowKind::Overlay)]
        }
        LifecycleEvent::ToggleOverlay { visible: false } => vec![
            LifecycleEffect::Show(WindowKind::Overlay),
            LifecycleEffect::Focus(WindowKind::Overlay),
        ],
        LifecycleEvent::OpenManager | LifecycleEvent::SecondInstance => vec![
            LifecycleEffect::Show(WindowKind::Manager),
            LifecycleEffect::Unminimize(WindowKind::Manager),
            LifecycleEffect::Focus(WindowKind::Manager),
        ],
        LifecycleEvent::CheckForUpdates => vec![
            LifecycleEffect::Show(WindowKind::Manager),
            LifecycleEffect::Unminimize(WindowKind::Manager),
            LifecycleEffect::Focus(WindowKind::Manager),
            LifecycleEffect::EmitUpdateCheck,
        ],
        LifecycleEvent::SetOverlayTopmost(enabled) => vec![
            LifecycleEffect::SetTopmost(WindowKind::Overlay, enabled),
            LifecycleEffect::PersistTopmost(enabled),
        ],
        LifecycleEvent::ExplicitQuit => vec![LifecycleEffect::Exit],
    }
}

pub fn tray_action(id: &str) -> Option<LifecycleEvent> {
    match id {
        "show_overlay" => Some(LifecycleEvent::ShowOverlay),
        "hide_overlay" => Some(LifecycleEvent::HideOverlay),
        "open_manager" => Some(LifecycleEvent::OpenManager),
        "check_updates" => Some(LifecycleEvent::CheckForUpdates),
        "quit" => Some(LifecycleEvent::ExplicitQuit),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Monitor {
    pub work_area: Bounds,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecoveryReason {
    Startup,
    ScaleFactorChanged,
    MovedOrResized,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WindowPresentation {
    Normal,
    Minimized,
    Maximized,
    Fullscreen,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RecoveryPlan {
    pub position: Option<(i32, i32)>,
    pub inner_size: Option<(u32, u32)>,
}

pub fn clamp_bounds(saved: Bounds, monitors: &[Monitor], minimum: (u32, u32)) -> Bounds {
    let Some(monitor) = nearest_monitor(saved, monitors) else {
        return saved;
    };
    let work = monitor.work_area;
    let width = saved.width.max(minimum.0).min(work.width);
    let height = saved.height.max(minimum.1).min(work.height);
    let max_x = i64::from(work.x) + i64::from(work.width.saturating_sub(width));
    let max_y = i64::from(work.y) + i64::from(work.height.saturating_sub(height));
    Bounds {
        x: i64::from(saved.x).clamp(i64::from(work.x), max_x) as i32,
        y: i64::from(saved.y).clamp(i64::from(work.y), max_y) as i32,
        width,
        height,
    }
}

pub fn minimum_physical_size(kind: WindowKind, scale_factor: f64) -> (u32, u32) {
    let minimum = kind.minimum_size();
    (
        (f64::from(minimum.0) * scale_factor).round() as u32,
        (f64::from(minimum.1) * scale_factor).round() as u32,
    )
}

pub fn recovery_adjustment(
    current: Bounds,
    monitors: &[Monitor],
    minimum: (u32, u32),
    reason: RecoveryReason,
    presentation: WindowPresentation,
) -> Option<Bounds> {
    if presentation != WindowPresentation::Normal {
        return None;
    }
    if reason == RecoveryReason::MovedOrResized
        && meaningfully_visible(current, monitors)
        && monitors.iter().any(|monitor| {
            current.width <= monitor.work_area.width && current.height <= monitor.work_area.height
        })
    {
        return None;
    }
    let recovered = clamp_bounds(current, monitors, minimum);
    (recovered != current).then_some(recovered)
}

fn meaningfully_visible(bounds: Bounds, monitors: &[Monitor]) -> bool {
    monitors.iter().any(|monitor| {
        let work = monitor.work_area;
        let width = ((i64::from(bounds.x) + i64::from(bounds.width))
            .min(i64::from(work.x) + i64::from(work.width))
            - i64::from(bounds.x).max(i64::from(work.x)))
        .max(0) as u32;
        let height = ((i64::from(bounds.y) + i64::from(bounds.height))
            .min(i64::from(work.y) + i64::from(work.height))
            - i64::from(bounds.y).max(i64::from(work.y)))
        .max(0) as u32;
        width >= bounds.width.min(64) && height >= bounds.height.min(32)
    })
}

pub fn outer_target_to_inner_size(
    target_outer: (u32, u32),
    current_outer: (u32, u32),
    current_inner: (u32, u32),
) -> (u32, u32) {
    (
        target_outer
            .0
            .saturating_sub(current_outer.0.saturating_sub(current_inner.0)),
        target_outer
            .1
            .saturating_sub(current_outer.1.saturating_sub(current_inner.1)),
    )
}

pub fn recovery_plan(
    current: Bounds,
    current_inner: (u32, u32),
    monitors: &[Monitor],
    minimum_inner: (u32, u32),
    reason: RecoveryReason,
    presentation: WindowPresentation,
) -> Option<RecoveryPlan> {
    if presentation != WindowPresentation::Normal {
        return None;
    }
    let decoration = (
        current.width.saturating_sub(current_inner.0),
        current.height.saturating_sub(current_inner.1),
    );
    let minimum_outer = (
        minimum_inner.0.saturating_add(decoration.0),
        minimum_inner.1.saturating_add(decoration.1),
    );
    let target = recovery_adjustment(current, monitors, minimum_outer, reason, presentation)?;
    let monitor = nearest_monitor(current, monitors)?;
    let minimum_fits =
        minimum_outer.0 <= monitor.work_area.width && minimum_outer.1 <= monitor.work_area.height;
    let position = ((target.x, target.y) != (current.x, current.y)).then_some((target.x, target.y));
    let inner_size =
        if minimum_fits && (target.width, target.height) != (current.width, current.height) {
            Some(outer_target_to_inner_size(
                (target.width, target.height),
                (current.width, current.height),
                current_inner,
            ))
        } else {
            None
        };
    (position.is_some() || inner_size.is_some()).then_some(RecoveryPlan {
        position,
        inner_size,
    })
}

fn nearest_monitor(saved: Bounds, monitors: &[Monitor]) -> Option<&Monitor> {
    monitors.iter().max_by_key(|monitor| {
        let work = monitor.work_area;
        let left = i64::from(saved.x).max(i64::from(work.x));
        let top = i64::from(saved.y).max(i64::from(work.y));
        let right = (i64::from(saved.x) + i64::from(saved.width))
            .min(i64::from(work.x) + i64::from(work.width));
        let bottom = (i64::from(saved.y) + i64::from(saved.height))
            .min(i64::from(work.y) + i64::from(work.height));
        let intersection = (right - left).max(0) * (bottom - top).max(0);
        if intersection > 0 {
            return (1_i64, intersection, 0_i64);
        }
        let saved_center_x = i64::from(saved.x) * 2 + i64::from(saved.width);
        let saved_center_y = i64::from(saved.y) * 2 + i64::from(saved.height);
        let work_center_x = i64::from(work.x) * 2 + i64::from(work.width);
        let work_center_y = i64::from(work.y) * 2 + i64::from(work.height);
        let distance =
            (saved_center_x - work_center_x).pow(2) + (saved_center_y - work_center_y).pow(2);
        (0_i64, 0_i64, -distance)
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSettingsDto {
    pub always_on_top: bool,
}

pub struct WindowServiceState(Mutex<Repository>);

impl WindowServiceState {
    pub fn new(repository: Repository) -> Self {
        Self(Mutex::new(repository))
    }

    fn lock(&self) -> Result<MutexGuard<'_, Repository>, AppError> {
        self.0.lock().map_err(|_| AppError::Internal {
            message_key: "errors.internal",
        })
    }

    pub fn settings(&self) -> Result<WindowSettingsDto, AppError> {
        let repository = self.lock()?;
        settings_from_repository(&repository)
    }

    fn settings_and_emit<R: Runtime>(
        &self,
        app: &AppHandle<R>,
    ) -> Result<WindowSettingsDto, AppError> {
        let repository = self.lock()?;
        let settings = settings_from_repository(&repository)?;
        let _ = app.emit("window-settings-changed", settings);
        Ok(settings)
    }

    fn set_topmost<R: Runtime>(&self, app: &AppHandle<R>, enabled: bool) -> Result<(), AppError> {
        let mut repository = self.lock()?;
        let overlay =
            app.get_webview_window(WindowKind::Overlay.label())
                .ok_or(AppError::Internal {
                    message_key: "errors.internal",
                })?;
        let previous = overlay.is_always_on_top().unwrap_or(!enabled);
        overlay
            .set_always_on_top(enabled)
            .map_err(|_| AppError::Internal {
                message_key: "errors.internal",
            })?;
        if let Err(error) = repository
            .transaction(|tx| {
                tx.upsert_setting(&SettingRecord {
                    key: OVERLAY_TOPMOST_KEY.into(),
                    value: enabled.to_string(),
                })
            })
            .map_err(|_| AppError::Database {
                message_key: "errors.database",
            })
        {
            let _ = overlay.set_always_on_top(previous);
            return Err(error);
        }
        let _ = app.emit(
            "window-settings-changed",
            WindowSettingsDto {
                always_on_top: enabled,
            },
        );
        Ok(())
    }
}

fn settings_from_repository(repository: &Repository) -> Result<WindowSettingsDto, AppError> {
    let always_on_top = repository
        .snapshot()
        .map_err(|_| AppError::Database {
            message_key: "errors.database",
        })?
        .settings
        .iter()
        .find(|setting| setting.key == OVERLAY_TOPMOST_KEY)
        .map_or_else(default_overlay_topmost, |setting| setting.value == "true");
    Ok(WindowSettingsDto { always_on_top })
}

pub struct TrayState<R: Runtime> {
    _tray: TrayIcon<R>,
}

pub fn apply_lifecycle<R: Runtime>(app: &AppHandle<R>, event: LifecycleEvent) {
    for effect in lifecycle_effects(event) {
        match effect {
            LifecycleEffect::Show(window) => {
                if let Some(window) = app.get_webview_window(window.label()) {
                    let _ = window.show();
                }
            }
            LifecycleEffect::Hide(window) => {
                if let Some(window) = app.get_webview_window(window.label()) {
                    let _ = window.hide();
                }
            }
            LifecycleEffect::Unminimize(window) => {
                if let Some(window) = app.get_webview_window(window.label()) {
                    let _ = window.unminimize();
                }
            }
            LifecycleEffect::Focus(window) => {
                if let Some(window) = app.get_webview_window(window.label()) {
                    let _ = window.set_focus();
                }
            }
            LifecycleEffect::EmitUpdateCheck => {
                let _ = app.emit_to("manager", "open-update-settings", ());
            }
            LifecycleEffect::SetTopmost(window, enabled) => {
                if let Some(window) = app.get_webview_window(window.label()) {
                    let _ = window.set_always_on_top(enabled);
                }
            }
            LifecycleEffect::Exit => app.exit(0),
            LifecycleEffect::PersistTopmost(_) => {}
        }
    }
}

pub fn toggle_overlay<R: Runtime>(app: &AppHandle<R>) {
    let visible = app
        .get_webview_window(WindowKind::Overlay.label())
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    apply_lifecycle(app, LifecycleEvent::ToggleOverlay { visible });
}

pub fn install_window_lifecycle<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    for kind in [WindowKind::Overlay, WindowKind::Manager] {
        if let Some(window) = app.get_webview_window(kind.label()) {
            let event_window = window.clone();
            let recovering = Arc::new(AtomicBool::new(false));
            window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = event_window.hide();
                }
                WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::ScaleFactorChanged { .. } => {
                    let reason = if matches!(event, WindowEvent::ScaleFactorChanged { .. }) {
                        RecoveryReason::ScaleFactorChanged
                    } else {
                        RecoveryReason::MovedOrResized
                    };
                    let _ = recover_webview_window_bounds(
                        &event_window,
                        kind,
                        reason,
                        recovering.as_ref(),
                    );
                }
                _ => {}
            });
        }
    }
    recover_window_bounds(app.handle())
}

pub fn recover_window_bounds<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    for kind in [WindowKind::Overlay, WindowKind::Manager] {
        let Some(window) = app.get_webview_window(kind.label()) else {
            continue;
        };
        recover_webview_window_bounds(
            &window,
            kind,
            RecoveryReason::Startup,
            &AtomicBool::new(false),
        )?;
    }
    Ok(())
}

struct RecoveryGuard<'a>(&'a AtomicBool);

impl Drop for RecoveryGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn recover_webview_window_bounds<R: Runtime>(
    window: &WebviewWindow<R>,
    kind: WindowKind,
    reason: RecoveryReason,
    recovering: &AtomicBool,
) -> tauri::Result<bool> {
    if recovering
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(false);
    }
    let _guard = RecoveryGuard(recovering);
    let monitors = window
        .available_monitors()?
        .into_iter()
        .map(|monitor| {
            let area = monitor.work_area();
            Monitor {
                work_area: Bounds {
                    x: area.position.x,
                    y: area.position.y,
                    width: area.size.width,
                    height: area.size.height,
                },
            }
        })
        .collect::<Vec<_>>();
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let presentation = if window.is_minimized()? {
        WindowPresentation::Minimized
    } else if window.is_maximized()? {
        WindowPresentation::Maximized
    } else if window.is_fullscreen()? {
        WindowPresentation::Fullscreen
    } else {
        WindowPresentation::Normal
    };
    let current = Bounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let inner = window.inner_size()?;
    let Some(plan) = recovery_plan(
        current,
        (inner.width, inner.height),
        &monitors,
        minimum_physical_size(kind, window.scale_factor()?),
        reason,
        presentation,
    ) else {
        return Ok(false);
    };
    if let Some((width, height)) = plan.inner_size {
        window.set_size(PhysicalSize::new(width, height))?;
    }
    if let Some((x, y)) = plan.position {
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    let _ = window
        .app_handle()
        .save_window_state(StateFlags::SIZE | StateFlags::POSITION);
    Ok(true)
}

pub fn schedule_bounds_recovery<R: Runtime>(app: &App<R>) {
    for window in app.webview_windows().into_values() {
        let app_handle = app.handle().clone();
        window.once("tauri://page-load", move |_| {
            let _ = recover_window_bounds(&app_handle);
        });
    }
}

pub fn create_tray<R: Runtime>(app: &App<R>) -> tauri::Result<TrayState<R>> {
    let show = MenuItem::with_id(
        app,
        "show_overlay",
        "顯示浮動視窗 / Show Overlay",
        true,
        None::<&str>,
    )?;
    let hide = MenuItem::with_id(
        app,
        "hide_overlay",
        "隱藏浮動視窗 / Hide Overlay",
        true,
        None::<&str>,
    )?;
    let manager = MenuItem::with_id(
        app,
        "open_manager",
        "開啟管理器 / Open Manager",
        true,
        None::<&str>,
    )?;
    let updates = MenuItem::with_id(
        app,
        "check_updates",
        "檢查更新 / Check for Updates",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "結束 PartyPaste / Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &hide, &manager, &updates, &separator, &quit])?;
    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("PartyPaste")
        .on_menu_event(|app, event| {
            if let Some(action) = tray_action(event.id().as_ref()) {
                apply_lifecycle(app, action);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    Ok(TrayState {
        _tray: builder.build(app)?,
    })
}

#[tauri::command]
pub fn show_overlay(app: AppHandle) {
    apply_lifecycle(&app, LifecycleEvent::ShowOverlay);
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) {
    apply_lifecycle(&app, LifecycleEvent::HideOverlay);
}

#[tauri::command]
pub fn open_manager(app: AppHandle) {
    apply_lifecycle(&app, LifecycleEvent::OpenManager);
}

#[tauri::command]
pub fn get_window_settings(
    app: AppHandle,
    state: State<'_, WindowServiceState>,
) -> Result<WindowSettingsDto, AppError> {
    state.settings_and_emit(&app)
}

#[tauri::command]
pub fn toggle_topmost(
    app: AppHandle,
    state: State<'_, WindowServiceState>,
    always_on_top: bool,
) -> Result<bool, AppError> {
    state.set_topmost(&app, always_on_top)?;
    Ok(always_on_top)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    apply_lifecycle(&app, LifecycleEvent::ExplicitQuit);
}
