import { invokeCommand, type NativeInvoke } from "./commands";

export interface WindowSettingsDto {
  alwaysOnTop: boolean;
}

export interface WindowSettingsApi {
  getWindowSettings(): Promise<WindowSettingsDto>;
  toggleTopmost(enabled: boolean): Promise<boolean>;
}

export function createWindowSettingsApi(
  invoke: NativeInvoke = (name, input) => invokeCommand(name, input),
): WindowSettingsApi {
  return {
    getWindowSettings: () =>
      invoke<WindowSettingsDto>("get_window_settings", {}),
    toggleTopmost: (alwaysOnTop) =>
      invoke<boolean>("toggle_topmost", { alwaysOnTop }),
  };
}
