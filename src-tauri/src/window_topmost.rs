use std::{
    io,
    thread,
    time::Duration,
};

use tauri::WebviewWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GWL_EXSTYLE,
    GetWindowLongPtrW,
    HWND_TOPMOST,
    IsWindow,
    SWP_ASYNCWINDOWPOS,
    SWP_NOACTIVATE,
    SWP_NOMOVE,
    SWP_NOOWNERZORDER,
    SWP_NOSIZE,
    SetWindowPos,
    WS_EX_TOPMOST,
};

const REFRESH_INTERVAL: Duration = Duration::from_millis(250);

pub fn start_topmost_keeper(window: &WebviewWindow) -> io::Result<()> {
    let raw_hwnd = window
        .hwnd()
        .map_err(io::Error::other)?
        .0 as isize;

    // 只有目前設定為置頂時才重新調整 z-order。
    if is_topmost(raw_hwnd) {
        raise_to_topmost(raw_hwnd)?;
    }

    thread::Builder::new()
        .name("partypaste-topmost-keeper".into())
        .spawn(move || loop {
            thread::sleep(REFRESH_INTERVAL);

            let hwnd = raw_hwnd as _;

            if unsafe { IsWindow(hwnd) } == 0 {
                break;
            }

            // 使用者關閉「永遠置頂」時不做任何事。
            if !is_topmost(raw_hwnd) {
                continue;
            }

            // 暫時失敗時留待下一輪重試。
            let _ = raise_to_topmost(raw_hwnd);
        })?;

    Ok(())
}

fn is_topmost(raw_hwnd: isize) -> bool {
    let extended_style = unsafe {
        GetWindowLongPtrW(raw_hwnd as _, GWL_EXSTYLE)
    };

    (extended_style as u32 & WS_EX_TOPMOST) != 0
}

fn raise_to_topmost(raw_hwnd: isize) -> io::Result<()> {
    let succeeded = unsafe {
        SetWindowPos(
            raw_hwnd as _,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE
                | SWP_NOSIZE
                | SWP_NOACTIVATE
                | SWP_NOOWNERZORDER
                | SWP_ASYNCWINDOWPOS,
        )
    };

    if succeeded == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}