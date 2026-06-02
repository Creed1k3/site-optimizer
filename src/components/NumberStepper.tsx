import { useEffect, useRef } from "react";

interface NumberStepperProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  "aria-label"?: string;
}

// A themed numeric input with custom up/down arrows. The mouse wheel adjusts the
// value while the page stays put (the wheel handler preventDefaults), so spinning
// the number never scrolls the app behind it.
export function NumberStepper({ value, min, max, step = 1, onChange, ...rest }: NumberStepperProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const bump = (dir: number) => onChange(clamp(value + dir * step));

  // Native non-passive wheel listener — a React onWheel can't preventDefault
  // because React registers wheel handlers as passive.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      onChange(clamp(value + (e.deltaY < 0 ? step : -step)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [value, min, max, step, onChange]);

  return (
    <div className="num-stepper" ref={rootRef}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={rest["aria-label"]}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(clamp(next));
        }}
      />
      <div className="ns-btns">
        <button className="ns-btn" type="button" aria-label="Increase" disabled={value >= max} onClick={() => bump(1)}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10l4-4 4 4" /></svg>
        </button>
        <button className="ns-btn" type="button" aria-label="Decrease" disabled={value <= min} onClick={() => bump(-1)}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>
        </button>
      </div>
    </div>
  );
}
