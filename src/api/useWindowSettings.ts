import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowSettingsApi } from "./window-settings";

export function useWindowSettings(api: WindowSettingsApi) {
  const [alwaysOnTop, setAlwaysOnTop] = useState<boolean | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const confirmedSequence = useRef(0);

  useEffect(() => {
    void attempt;
    let active = true;
    let unlisten: (() => void) | undefined;
    const generation = confirmedSequence.current + 1;
    confirmedSequence.current = generation;
    setPending(true);
    setError(false);
    void (async () => {
      try {
        if (api.subscribeToWindowSettings) {
          const stop = await api.subscribeToWindowSettings((settings) => {
            if (!active) return;
            confirmedSequence.current += 1;
            setAlwaysOnTop(settings.alwaysOnTop);
            setError(false);
          });
          if (!active) {
            stop();
            return;
          }
          unlisten = stop;
        }
        const readSequence = confirmedSequence.current;
        try {
          const settings = await api.getWindowSettings();
          if (active && readSequence === confirmedSequence.current) {
            setAlwaysOnTop(settings.alwaysOnTop);
          }
        } catch {
          if (active && readSequence === confirmedSequence.current) {
            setAlwaysOnTop(null);
            setError(true);
          }
        }
      } catch {
        if (active && generation === confirmedSequence.current) {
          setAlwaysOnTop(null);
          setError(true);
        }
      } finally {
        if (active) setPending(false);
      }
    })();
    return () => {
      active = false;
      confirmedSequence.current += 1;
      unlisten?.();
    };
  }, [api, attempt]);

  const toggle = useCallback(async () => {
    if (alwaysOnTop === null || pending) return;
    const previous = alwaysOnTop;
    const mutationSequence = confirmedSequence.current;
    setPending(true);
    setError(false);
    try {
      const confirmed = await api.toggleTopmost(!previous);
      if (mutationSequence === confirmedSequence.current) {
        setAlwaysOnTop(confirmed);
      }
    } catch {
      if (mutationSequence === confirmedSequence.current) {
        setAlwaysOnTop(previous);
        setError(true);
      }
    } finally {
      setPending(false);
    }
  }, [alwaysOnTop, api, pending]);

  return {
    alwaysOnTop,
    error,
    pending,
    retry: () => setAttempt((value) => value + 1),
    toggle,
  };
}
