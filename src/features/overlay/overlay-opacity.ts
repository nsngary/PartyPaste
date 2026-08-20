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
const DEFAULT_OPACITY_PERCENT = 100;
const MINIMUM_MANUAL_OPACITY_PERCENT = 40;
const IDLE_OPACITY = 0.3;
const IDLE_DELAY_MS = 5_000;

interface StoredOpacitySettings {
    manualOpacityPercent: number;
    autoFadeEnabled: boolean;
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

function readSotredSettings(): StoredOpacitySettings {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);

        if (!raw) {
            throw new Error("Missing stored opacity settings.");
        }

        const parsed = JSON.parse(
            raw,
        ) as Partial<StoredOpacitySettings>;

        const manualOpacityPercent =
            typeof parsed.manualOpacityPercent === "number"
                ? Math.round(parsed.manualOpacityPercent)
                : DEFAULT_OPACITY_PERCENT;

        return {
            manualOpacityPercent: Math.min(
                100,
                Math.max(
                    MINIMUM_MANUAL_OPACITY_PERCENT,
                    manualOpacityPercent,
                ),
            ),
            autoFadeEnabled: parsed.autoFadeEnabled === true,
        };
    } catch {
        return {
            manualOpacityPercent: DEFAULT_OPACITY_PERCENT,
            autoFadeEnabled: false,
        };
    }
}

export function useOverlayOpacity(api: OverlayOpacityApi) {
    const initialSettings = useRef(readSotredSettings());

    const [manualOpacityPercent, setManualOpcityPercentState] =
        useState(initialSettings.current.manualOpacityPercent);

    const [autoFadeEnabled, setAutoFadeEnabled] = useState(
        initialSettings.current.autoFadeEnabled,
    );

    const [idle, setIdle] = useState(false);
    const [error, setError] = useState(false);

    const idleTimer = useRef<number | null>(null);
    const desiredOpacity = useRef<number | null>(null);
    const appliedOpacity = useRef<number | null>(null);
    const applying = useRef(false);

    const clearIdleTimer = useCallback(() => {
        if (idleTimer.current !== null) {
            window.clearTimeout(idleTimer.current);
            idleTimer.current = null;
        }
    }, []);

    const markActive = useCallback(() => {
        clearIdleTimer();
        setIdle(false);

        if (autoFadeEnabled) {
            idleTimer.current = window.setTimeout(() => {
                setIdle(true);
            }, IDLE_DELAY_MS);
        }
    }, [autoFadeEnabled, clearIdleTimer]);

    useEffect(() => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                manualOpacityPercent,
                autoFadeEnabled,
            } satisfies StoredOpacitySettings)
        )
    }, [autoFadeEnabled, manualOpacityPercent]);

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
            "focus",
        ] as const;

        for (const eventName of activityEvents) {
            window.addEventListener(eventName, markActive, {
                passive: true,
            });
        }

        return () => {
            clearIdleTimer();

            for (const eventName of activityEvents) {
                window.removeEventListener(eventName, markActive);
            }
        };
    }, [
        autoFadeEnabled,
        clearIdleTimer,
        markActive,
    ]);

    const flushOpacity = useCallback(async () => {
        if (applying.current) {
            return;
        }

        applying.current = true;

        try {
            while (
                desiredOpacity.current !== null &&
                desiredOpacity.current !== appliedOpacity.current
            ) {
                const target = desiredOpacity.current;

                try {
                    await api.setOpacity(target);
                    appliedOpacity.current = target;
                    setError(false);
                } catch {
                    setError(true);
                    break;
                }
            }
        } finally {
            applying.current = false;
        }
    }, [api]);

    const effectiveOpacity =
        autoFadeEnabled && idle
            ? IDLE_OPACITY
            : manualOpacityPercent / 100;

    useEffect(() => {
        desiredOpacity.current = effectiveOpacity;
        void flushOpacity();
    }, [effectiveOpacity, flushOpacity]);

    const setManualOpacityPercent = useCallback(
        (value: number) => {
            const normalized = Math.min(
                100,
                Math.max(
                    MINIMUM_MANUAL_OPACITY_PERCENT,
                    Math.round(value),
                ),
            );

            setManualOpcityPercentState(normalized);
            markActive();
        },
        [markActive],
    );

    return {
        autoFadeEnabled,
        error,
        idle,
        manualOpacityPercent,

        retry() {
            appliedOpacity.current = null;
            void flushOpacity();
        },

        setAutoFadeEnabled(enabled: boolean) {
            setAutoFadeEnabled(enabled);
        },

        setManualOpacityPercent,
    };
}