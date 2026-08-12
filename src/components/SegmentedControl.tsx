import type { KeyboardEvent } from "react";

export interface SegmentedOption<Value extends string> {
  disabled?: boolean;
  label: string;
  value: Value;
}

export interface SegmentedControlProps<Value extends string> {
  ariaLabel: string;
  onChange: (value: Value) => void;
  options: readonly SegmentedOption<Value>[];
  value: Value;
}

export function SegmentedControl<Value extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: SegmentedControlProps<Value>) {
  const enabledOptions = options.filter((option) => !option.disabled);
  const hasEnabledSelection = enabledOptions.some(
    (option) => option.value === value,
  );
  const tabbableValue = hasEnabledSelection ? value : enabledOptions[0]?.value;

  function selectFromKey(
    event: KeyboardEvent<HTMLButtonElement>,
    option: SegmentedOption<Value>,
  ) {
    if (enabledOptions.length === 0) return;
    const currentIndex = enabledOptions.findIndex(
      ({ value: itemValue }) => itemValue === option.value,
    );
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % enabledOptions.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + enabledOptions.length) % enabledOptions.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = enabledOptions.length - 1;
    }

    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = enabledOptions[nextIndex];
    onChange(next.value);
    const control = event.currentTarget.parentElement;
    Array.from(
      control?.querySelectorAll<HTMLButtonElement>("[data-value]") ?? [],
    )
      .find((button) => button.dataset.value === next.value)
      ?.focus();
  }

  return (
    <div aria-label={ariaLabel} className="pp-segmented" role="radiogroup">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: This follows the WAI-ARIA radio-group roving-tabindex pattern.
          <button
            aria-checked={selected}
            className="pp-segmented__option"
            data-value={option.value}
            disabled={option.disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => selectFromKey(event, option)}
            role="radio"
            tabIndex={option.value === tabbableValue ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
