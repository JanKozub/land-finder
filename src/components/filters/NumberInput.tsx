import { useEffect, useState } from "react";
import { Input } from "../ui";

/** Numeric input that commits on blur/Enter (avoids a refetch per keystroke). Empty = null. */
export function NumberInput({
  value,
  onCommit,
  placeholder,
  suffix,
  min,
  step,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  placeholder?: string;
  suffix?: string;
  min?: number;
  step?: number;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const trimmed = text.trim().replace(",", ".");
    if (trimmed === "") return onCommit(null);
    const n = Number(trimmed);
    if (Number.isFinite(n)) onCommit(n);
    else setText(value === null ? "" : String(value));
  };
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        value={text}
        min={min}
        step={step}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className={suffix ? "pr-12" : undefined}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-slate-500">{suffix}</span>}
    </div>
  );
}
