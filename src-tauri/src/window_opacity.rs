use std::io;

use tauri::WebviewWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GWL_EXSTYLE, GetWindowLongPtrW, LWA_ALPHA, SetLayeredWindowAttributes,
    SetWindowLongPtrW, WS_EX_LAYERED,
};

pub fn set_window_opacity(
    window: &WebviewWindow,
    opacity: f64,
) -> io::Result<()> {
    let raw_hwnd = window
        .hwnd()
        .map_err(io::Error::other)?
        .0 as isize;

    let extended_style =
        unsafe { GetWindowLongPtrW(raw_hwnd as _, GWL_EXSTYLE) };

    unsafe {
        SetWindowLongPtrW(
            raw_hwnd as _,
            GWL_EXSTYLE,
            extended_style | WS_EX_LAYERED as isize,
        );
    }

    let alpha = (opacity * 255.0).round() as u8;

    let succeeded = unsafe {
        SetLayeredWindowAttributes(
            raw_hwnd as _,
            0,
            alpha,
            LWA_ALPHA,
        )
    };

    if succeeded == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}