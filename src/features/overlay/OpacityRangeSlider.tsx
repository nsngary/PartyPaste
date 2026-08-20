import type {
  CSSProperties,
  PointerEvent,
} from "react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

const MINIMUM_OPACITY = 10;
const MAXIMUM_OPACITY = 100;
const THUMB_RADIUS_PX = 7;

type DraggedThumb = "active" | "faded";

interface PointerDragState {
  pointerId: number;
  thumb: DraggedThumb;
}

export interface OpacityRangeSliderProps {
  activeOpacityPercent: number;
  autoFadeEnabled: boolean;
  fadedOpacityPercent: number;
  onActiveOpacityChange: (value: number) => void;
  onFadedOpacityChange: (value: number) => void;
}

type SliderStyle = CSSProperties & {
  "--pp-opacity-high": string;
  "--pp-opacity-low": string;
};

function clampOpacity(value: number): number {
  return Math.min(
    MAXIMUM_OPACITY,
    Math.max(MINIMUM_OPACITY, Math.round(value)),
  );
}

function toTrackPercent(value: number): string {
  const clamped = clampOpacity(value);

  const position =
    ((clamped - MINIMUM_OPACITY) /
      (MAXIMUM_OPACITY - MINIMUM_OPACITY)) *
    100;

  return `${position}%`;
}

function opacityFromPointer(
  element: HTMLDivElement,
  clientX: number,
): number {
  const bounds = element.getBoundingClientRect();

  const usableWidth = Math.max(
    1,
    bounds.width - THUMB_RADIUS_PX * 2,
  );

  const pointerPosition = Math.min(
    usableWidth,
    Math.max(
      0,
      clientX -
        bounds.left -
        THUMB_RADIUS_PX,
    ),
  );

  const ratio = pointerPosition / usableWidth;

  return clampOpacity(
    MINIMUM_OPACITY +
      ratio *
        (MAXIMUM_OPACITY - MINIMUM_OPACITY),
  );
}

function selectNearestThumb(
  value: number,
  activeValue: number,
  fadedValue: number,
): DraggedThumb {
  const fadedDistance = Math.abs(
    value - fadedValue,
  );

  const activeDistance = Math.abs(
    value - activeValue,
  );

  if (fadedDistance < activeDistance) {
    return "faded";
  }

  if (activeDistance < fadedDistance) {
    return "active";
  }

  /*
   * 距離相同或 Thumb 重疊時，
   * 點右側選 active，點左側選 faded。
   */
  return value >= activeValue
    ? "active"
    : "faded";
}

function thumbFromTarget(
  target: EventTarget,
): DraggedThumb | null {
  if (!(target instanceof HTMLInputElement)) {
    return null;
  }

  if (
    target.classList.contains(
      "pp-opacity-range__input--faded",
    )
  ) {
    return "faded";
  }

  if (
    target.classList.contains(
      "pp-opacity-range__input--active",
    )
  ) {
    return "active";
  }

  return null;
}

export function OpacityRangeSlider({
  activeOpacityPercent,
  autoFadeEnabled,
  fadedOpacityPercent,
  onActiveOpacityChange,
  onFadedOpacityChange,
}: OpacityRangeSliderProps) {
  const { t } = useTranslation();

  const pointerDrag =
    useRef<PointerDragState | null>(null);

  const style: SliderStyle = {
    "--pp-opacity-high": toTrackPercent(
      activeOpacityPercent,
    ),
    "--pp-opacity-low": autoFadeEnabled
      ? toTrackPercent(fadedOpacityPercent)
      : "0%",
  };

  function updateThumb(
    thumb: DraggedThumb,
    requestedValue: number,
  ) {
    const normalized =
      clampOpacity(requestedValue);

    if (!autoFadeEnabled) {
      onActiveOpacityChange(normalized);
      return;
    }

    if (thumb === "faded") {
      /*
       * Faded 只能到 Active 的位置，
       * 不可超過 Active。
       */
      onFadedOpacityChange(
        Math.min(
          normalized,
          activeOpacityPercent,
        ),
      );

      return;
    }

    /*
     * Active 只能到 Faded 的位置，
     * 不可低於 Faded。
     */
    onActiveOpacityChange(
      Math.max(
        normalized,
        fadedOpacityPercent,
      ),
    );
  }

  function handlePointerDown(
    event: PointerEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    const nextValue = opacityFromPointer(
      event.currentTarget,
      event.clientX,
    );

    /*
     * 直接按到 Thumb 時，固定選該 Thumb。
     * 點到軌道時，選擇距離最近的 Thumb。
     */
    const targetThumb = thumbFromTarget(
      event.target,
    );

    const thumb =
      targetThumb ??
      (autoFadeEnabled
        ? selectNearestThumb(
            nextValue,
            activeOpacityPercent,
            fadedOpacityPercent,
          )
        : "active");

    pointerDrag.current = {
      pointerId: event.pointerId,
      thumb,
    };

    /*
     * 由外層統一接管 Pointer，
     * 不讓兩個原生 range 各自使用不同邏輯。
     */
    event.currentTarget.setPointerCapture(
      event.pointerId,
    );

    updateThumb(thumb, nextValue);
  }

  function handlePointerMove(
    event: PointerEvent<HTMLDivElement>,
  ) {
    const drag = pointerDrag.current;

    if (
      !drag ||
      drag.pointerId !== event.pointerId
    ) {
      return;
    }

    if (
      event.pointerType === "mouse" &&
      event.buttons === 0
    ) {
      finishPointerDrag(event);
      return;
    }

    event.preventDefault();

    updateThumb(
      drag.thumb,
      opacityFromPointer(
        event.currentTarget,
        event.clientX,
      ),
    );
  }

  function finishPointerDrag(
    event: PointerEvent<HTMLDivElement>,
  ) {
    const drag = pointerDrag.current;

    if (
      !drag ||
      drag.pointerId !== event.pointerId
    ) {
      return;
    }

    pointerDrag.current = null;

    if (
      event.currentTarget.hasPointerCapture(
        event.pointerId,
      )
    ) {
      event.currentTarget.releasePointerCapture(
        event.pointerId,
      );
    }
  }

  function handleLostPointerCapture(
    event: PointerEvent<HTMLDivElement>,
  ) {
    if (
      pointerDrag.current?.pointerId ===
      event.pointerId
    ) {
      pointerDrag.current = null;
    }
  }

  return (
    <div
      className="pp-opacity-range"
      data-dual={autoFadeEnabled}
      onLostPointerCapture={
        handleLostPointerCapture
      }
      onPointerCancel={finishPointerDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      style={style}
    >
      <div
        aria-hidden="true"
        className="pp-opacity-range__track"
      />

      {autoFadeEnabled ? (
        <input
          aria-label={t("overlay.fadedOpacity")}
          aria-valuetext={`${fadedOpacityPercent}%`}
          className={[
            "pp-opacity-range__input",
            "pp-opacity-range__input--faded",
          ].join(" ")}
          max={MAXIMUM_OPACITY}
          min={MINIMUM_OPACITY}
          onChange={(event) =>
            updateThumb(
              "faded",
              Number(event.target.value),
            )
          }
          step="1"
          type="range"
          value={fadedOpacityPercent}
        />
      ) : null}

      <input
        aria-label={t(
          autoFadeEnabled
            ? "overlay.activeOpacity"
            : "overlay.opacity",
        )}
        aria-valuetext={`${activeOpacityPercent}%`}
        className={[
          "pp-opacity-range__input",
          "pp-opacity-range__input--active",
        ].join(" ")}
        max={MAXIMUM_OPACITY}
        min={MINIMUM_OPACITY}
        onChange={(event) =>
          updateThumb(
            "active",
            Number(event.target.value),
          )
        }
        step="1"
        type="range"
        value={activeOpacityPercent}
      />
    </div>
  );
}