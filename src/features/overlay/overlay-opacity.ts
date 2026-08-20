import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  invokeCommand,
  type NativeInvoke,
} from "../../api/commands";

const STORAGE_KEY = "partypaste.overlay-opacity";

const DEFAULT_ACTIVE_OPACITY = 100;
const DEFAULT_FADED_OPACITY = 30;
const DEFAULT_FADE_DELAY_SECONDS = 1;

const MINIMUM_OPACITY = 10;
const MAXIMUM_OPACITY = 100;
const MINIMUM_DELAY_SECONDS = 0.1;
const MAXIMUM_DELAY_SECONDS = 60;

const FADE_OUT_DURATION_MS = 300;
const RESTORE_DURATION_MS = 180;

interface StoredOpacitySettings {
  activeOpacityPercent: number;
  autoFadeEnabled: boolean;
  fadeDelaySeconds: number;
  fadedOpacityPercent: number;
}

interface LegacyStoredOpacitySettings {
  autoFadeEnabled?: boolean;
  manualOpacityPercent?: number;
}

export interface OverlayOpacityApi {
  setOpacity(opacity: number): Promise<void>;
}

export function createOverlayOpacityApi(
  invoke: NativeInvoke = (name, input) =>
    invokeCommand(name, input),
): OverlayOpacityApi {
  return {
    setOpacity: (opacity) =>
      invoke<void>("set_overlay_opacity", { opacity }),
  };
}

function clampOpacity(value: number): number {
  return Math.min(
    MAXIMUM_OPACITY,
    Math.max(MINIMUM_OPACITY, Math.round(value)),
  );
}

function clampDelay(value: number): number {
  const normalized =
    Math.round(value * 10) / 10;

  return Math.min(
    MAXIMUM_DELAY_SECONDS,
    Math.max(MINIMUM_DELAY_SECONDS, normalized),
  );
}

function easeInCubic(progress: number): number {
  return progress ** 3;
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches
  );
}

function requestOpacityFrame(
  callback: FrameRequestCallback,
): number {
  if (
    typeof window.requestAnimationFrame === "function"
  ) {
    return window.requestAnimationFrame(callback);
  }

  return window.setTimeout(
    () => callback(performance.now()),
    16,
  );
}

function cancelOpacityFrame(frameId: number): void {
  if (
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(frameId);
    return;
  }

  window.clearTimeout(frameId);
}

function readStoredSettings(): StoredOpacitySettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      throw new Error("Opacity settings are missing.");
    }

    const parsed = JSON.parse(raw) as Partial<
      StoredOpacitySettings &
        LegacyStoredOpacitySettings
    >;

    const activeOpacityPercent = clampOpacity(
      typeof parsed.activeOpacityPercent === "number"
        ? parsed.activeOpacityPercent
        : typeof parsed.manualOpacityPercent ===
            "number"
          ? parsed.manualOpacityPercent
          : DEFAULT_ACTIVE_OPACITY,
    );

    const fadedOpacityPercent = Math.min(
      activeOpacityPercent,
      clampOpacity(
        typeof parsed.fadedOpacityPercent === "number"
          ? parsed.fadedOpacityPercent
          : DEFAULT_FADED_OPACITY,
      ),
    );

    return {
      activeOpacityPercent,
      autoFadeEnabled:
        parsed.autoFadeEnabled === true,
      fadeDelaySeconds: clampDelay(
        typeof parsed.fadeDelaySeconds === "number"
          ? parsed.fadeDelaySeconds
          : DEFAULT_FADE_DELAY_SECONDS,
      ),
      fadedOpacityPercent,
    };
  } catch {
    return {
      activeOpacityPercent: DEFAULT_ACTIVE_OPACITY,
      autoFadeEnabled: false,
      fadeDelaySeconds: DEFAULT_FADE_DELAY_SECONDS,
      fadedOpacityPercent: DEFAULT_FADED_OPACITY,
    };
  }
}

export function useOverlayOpacity(
  api: OverlayOpacityApi,
) {
  const initialSettings = useRef(readStoredSettings());

  const [
    activeOpacityPercent,
    setActiveOpacityPercentState,
  ] = useState(
    initialSettings.current.activeOpacityPercent,
  );

  const [
    fadedOpacityPercent,
    setFadedOpacityPercentState,
  ] = useState(
    initialSettings.current.fadedOpacityPercent,
  );

  const [autoFadeEnabled, setAutoFadeEnabledState] =
    useState(initialSettings.current.autoFadeEnabled);

  const [fadeDelaySeconds, setFadeDelaySecondsState] =
    useState(initialSettings.current.fadeDelaySeconds);

  const [idle, setIdle] = useState(false);
  const [error, setError] = useState(false);

  const idleTimer = useRef<number | null>(null);
  const animationFrame = useRef<number | null>(null);
  const animationGeneration = useRef(0);
  const currentOpacity = useRef<number | null>(null);
  const desiredOpacity = useRef(
    initialSettings.current.activeOpacityPercent /
      100,
  );
  const previousIdle = useRef(false);

  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current === null) {
      return;
    }

    window.clearTimeout(idleTimer.current);
    idleTimer.current = null;
  }, []);

  const cancelOpacityAnimation = useCallback(() => {
    animationGeneration.current += 1;

    if (animationFrame.current !== null) {
      cancelOpacityFrame(animationFrame.current);
      animationFrame.current = null;
    }
  }, []);

  const applyOpacityImmediately = useCallback(
    async (opacity: number) => {
      cancelOpacityAnimation();

      const generation =
        animationGeneration.current;

      try {
        await api.setOpacity(opacity);

        if (
          generation !== animationGeneration.current
        ) {
          return;
        }

        currentOpacity.current = opacity;
        setError(false);
      } catch {
        if (
          generation === animationGeneration.current
        ) {
          setError(true);
        }
      }
    },
    [api, cancelOpacityAnimation],
  );

  const animateOpacity = useCallback(
    (
      targetOpacity: number,
      durationMs: number,
      easing: (progress: number) => number,
    ) => {
      cancelOpacityAnimation();

      const generation =
        animationGeneration.current;

      const startOpacity =
        currentOpacity.current ??
        desiredOpacity.current;

      if (
        prefersReducedMotion() ||
        durationMs <= 0 ||
        Math.abs(targetOpacity - startOpacity) <
          0.001
      ) {
        void applyOpacityImmediately(targetOpacity);
        return;
      }

      const startedAt = performance.now();

      const step = async (timestamp: number) => {
        if (
          generation !== animationGeneration.current
        ) {
          return;
        }

        const elapsed = timestamp - startedAt;
        const progress = Math.min(
          1,
          Math.max(0, elapsed / durationMs),
        );
        const easedProgress = easing(progress);

        const nextOpacity =
          startOpacity +
          (targetOpacity - startOpacity) *
            easedProgress;

        try {
          /*
           * 等待原生 command 完成後才排下一幀，
           * 避免大量 IPC opacity command 堆積。
           */
          await api.setOpacity(nextOpacity);

          if (
            generation !==
            animationGeneration.current
          ) {
            return;
          }

          currentOpacity.current = nextOpacity;
          setError(false);
        } catch {
          if (
            generation ===
            animationGeneration.current
          ) {
            setError(true);
          }

          return;
        }

        if (progress >= 1) {
          animationFrame.current = null;
          currentOpacity.current = targetOpacity;
          return;
        }

        animationFrame.current =
          requestOpacityFrame(step);
      };

      animationFrame.current =
        requestOpacityFrame(step);
    },
    [
      api,
      applyOpacityImmediately,
      cancelOpacityAnimation,
    ],
  );

  const markActive = useCallback(() => {
    clearIdleTimer();
    setIdle(false);

    if (autoFadeEnabled) {
      idleTimer.current = window.setTimeout(
        () => {
          setIdle(true);
        },
        fadeDelaySeconds * 1_000,
      );
    }
  }, [
    autoFadeEnabled,
    clearIdleTimer,
    fadeDelaySeconds,
  ]);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeOpacityPercent,
        autoFadeEnabled,
        fadeDelaySeconds,
        fadedOpacityPercent,
      } satisfies StoredOpacitySettings),
    );
  }, [
    activeOpacityPercent,
    autoFadeEnabled,
    fadeDelaySeconds,
    fadedOpacityPercent,
  ]);

  useEffect(() => {
    if (!autoFadeEnabled) {
      clearIdleTimer();
      setIdle(false);
      return;
    }

    markActive();

    const activityEvents = [
      "pointermove",
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
      "focusin",
    ] as const;

    for (const eventName of activityEvents) {
      window.addEventListener(
        eventName,
        markActive,
        { passive: true },
      );
    }

    return () => {
      clearIdleTimer();

      for (const eventName of activityEvents) {
        window.removeEventListener(
          eventName,
          markActive,
        );
      }
    };
  }, [
    autoFadeEnabled,
    clearIdleTimer,
    markActive,
  ]);

  const effectiveOpacityPercent =
    autoFadeEnabled && idle
      ? fadedOpacityPercent
      : activeOpacityPercent;

  useEffect(() => {
    const targetOpacity =
      effectiveOpacityPercent / 100;

    desiredOpacity.current = targetOpacity;

    const idleChanged =
      previousIdle.current !== idle;

    previousIdle.current = idle;

    /*
     * 只有自動淡化的 active/idle 狀態變化使用 easing。
     * Slider 數值改變與關閉自動淡化仍立即反映。
     */
    if (autoFadeEnabled && idleChanged) {
      animateOpacity(
        targetOpacity,
        idle
          ? FADE_OUT_DURATION_MS
          : RESTORE_DURATION_MS,
        idle ? easeInCubic : easeOutCubic,
      );

      return;
    }

    void applyOpacityImmediately(targetOpacity);
  }, [
    applyOpacityImmediately,
    animateOpacity,
    autoFadeEnabled,
    effectiveOpacityPercent,
    idle,
  ]);

  useEffect(
    () => () => {
      clearIdleTimer();
      cancelOpacityAnimation();
    },
    [
      cancelOpacityAnimation,
      clearIdleTimer,
    ],
  );

  const setActiveOpacityPercent = useCallback(
    (value: number) => {
      const normalized = clampOpacity(value);

      setActiveOpacityPercentState(normalized);

      setFadedOpacityPercentState((current) =>
        Math.min(current, normalized),
      );

      markActive();
    },
    [markActive],
  );

  const setFadedOpacityPercent = useCallback(
    (value: number) => {
      setFadedOpacityPercentState(
        Math.min(
          activeOpacityPercent,
          clampOpacity(value),
        ),
      );

      markActive();
    },
    [activeOpacityPercent, markActive],
  );

  const setAutoFadeEnabled = useCallback(
    (enabled: boolean) => {
      setAutoFadeEnabledState(enabled);
      setIdle(false);
    },
    [],
  );

  const setFadeDelaySeconds = useCallback(
    (value: number) => {
      setFadeDelaySecondsState(clampDelay(value));
      markActive();
    },
    [markActive],
  );

  return {
    activeOpacityPercent,
    autoFadeEnabled,
    error,
    fadeDelaySeconds,
    fadedOpacityPercent,
    idle,

    retry() {
      void applyOpacityImmediately(
        desiredOpacity.current,
      );
    },

    setActiveOpacityPercent,
    setAutoFadeEnabled,
    setFadeDelaySeconds,
    setFadedOpacityPercent,
  };
}