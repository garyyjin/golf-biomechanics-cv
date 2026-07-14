import { useId, useState } from "react";
import type { DragEvent } from "react";

interface Props {
  label: string;
  file: File | null;
  accept: string;
  disabled?: boolean;
  onChange: (file: File | null) => void;
}

/** A file input styled as a real button instead of the browser default —
 * the native input is visually hidden but still keyboard/screen-reader
 * accessible via the label it's paired with. Also accepts a dropped file
 * directly on the button/label area. */
export function FileField({ label, file, accept, disabled, onChange }: Props) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  function handleDragOver(e: DragEvent<HTMLLabelElement>) {
    if (disabled) return;
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const dropped = e.dataTransfer.files?.[0] ?? null;
    if (dropped) onChange(dropped);
  }

  const className = [disabled && "disabled", dragging && "dragging"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="field">
      <span>{label}</span>
      <input
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled}
        className="file-input-hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <label
        htmlFor={inputId}
        className={className ? `file-button ${className}` : "file-button"}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {file ? file.name : dragging ? "Drop video to select" : "Choose video or drag it here"}
      </label>
    </div>
  );
}
