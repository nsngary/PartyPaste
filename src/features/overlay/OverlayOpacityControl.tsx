import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
    type OverlayOpacityApi,
    useOverlayOpacity,
} from "./overlay-opacity";
import { OpacityRangeSlider } from "./OpacityRangeSlider";

export interface OverlayOpacityControlProps {
    opacityApi: OverlayOpacityApi;
}

export function OverlayOpacityControl({
    opacityApi,
}: OverlayOpacityControlProps) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);

    const {
        activeOpacityPercent,
        autoFadeEnabled,
        error,
        fadeDelaySeconds,
        fadedOpacityPercent,
        idle,
        retry,
        setActiveOpacityPercent,
        setAutoFadeEnabled,
        setFadeDelaySeconds,
        setFadedOpacityPercent,
    } = useOverlayOpacity(opacityApi);

    return (
        <section
            aria-label={t("overlay.opacitySettings")}
            className="pp-opacity-control"
            data-expanded={expanded}
        >
            <div className="pp-opacity-control__compact">
                <OpacityRangeSlider
                    activeOpacityPercent={activeOpacityPercent}
                    autoFadeEnabled={autoFadeEnabled}
                    fadedOpacityPercent={fadedOpacityPercent}
                    onActiveOpacityChange={
                        setActiveOpacityPercent
                    }
                    onFadedOpacityChange={
                        setFadedOpacityPercent
                    }
                />

                <button
                    aria-checked={autoFadeEnabled}
                    className="pp-switch"
                    onClick={() =>
                        setAutoFadeEnabled(!autoFadeEnabled)
                    }
                    role="switch"
                    type="button"
                >
                    <span
                        aria-hidden="true"
                        className="pp-switch__track"
                    >
                        <span className="pp-switch__thumb" />
                    </span>

                    <span className="pp-switch__label">
                        {t("overlay.autoFade")}
                    </span>
                </button>

                <button
                    aria-expanded={expanded}
                    className="pp-opacity-control__expand"
                    onClick={() =>
                        setExpanded((current) => !current)
                    }
                    title={t(
                        expanded
                            ? "overlay.collapseOpacitySettings"
                            : "overlay.expandOpacitySettings",
                    )}
                    type="button"
                >
                    <span className="pp-visually-hidden">
                        {t(
                            expanded
                                ? "overlay.collapseOpacitySettings"
                                : "overlay.expandOpacitySettings",
                        )}
                    </span>

                    {expanded ? (
                        <ChevronDown aria-hidden="true" size={16} />
                    ) : (
                        <ChevronUp aria-hidden="true" size={16} />
                    )}
                </button>
            </div>

            {expanded ? (
                <div className="pp-opacity-control__details">
                    <div className="pp-opacity-control__values">
                        {autoFadeEnabled ? (
                            <span>
                                {t("overlay.fadedOpacityValue", {
                                    value: fadedOpacityPercent,
                                })}
                            </span>
                        ) : null}

                        <span>
                            {t("overlay.activeOpacityValue", {
                                value: activeOpacityPercent,
                            })}
                        </span>
                    </div>

                    {autoFadeEnabled ? (
                        <label className="pp-opacity-control__delay">
                            <span>{t("overlay.fadeDelay")}</span>

                            <span className="pp-opacity-control__number">
                                <input
                                    inputMode="decimal"
                                    max="60"
                                    min="0.1"
                                    onChange={(event) =>
                                        setFadeDelaySeconds(
                                            Number(event.target.value),
                                        )
                                    }
                                    step="0.1"
                                    type="number"
                                    value={fadeDelaySeconds.toFixed(1)}
                                />

                                <span aria-hidden="true">s</span>
                            </span>
                        </label>
                    ) : null}

                    {autoFadeEnabled ? (
                        <p
                            aria-live="polite"
                            className="pp-opacity-control__status"
                        >
                            {t(
                                idle
                                    ? "overlay.opacityIdle"
                                    : "overlay.opacityActive",
                                {
                                    seconds:
                                        fadeDelaySeconds.toFixed(1),
                                    value: idle
                                        ? fadedOpacityPercent
                                        : activeOpacityPercent,
                                },
                            )}
                        </p>
                    ) : null}

                    {error ? (
                        <div
                            className="pp-opacity-control__error"
                            role="alert"
                        >
                            <span>{t("overlay.opacityFailed")}</span>

                            <button onClick={retry} type="button">
                                {t("common.retry")}
                            </button>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}