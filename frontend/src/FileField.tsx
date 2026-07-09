import { useId } from "react";

interface Props {
  label: string;
  file: File | null;
  accept: string;
  disabled?: boolean;
  onChange: (file: File | null) => void;
}

/** A file input styled as a real button instead of the browser default —
 * the native input is visually hidden but still keyboard/screen-reader
 * accessible via the label it's paired with. */
export function FileField({ label, file, accept, disabled, onChange }: Props) {
  const inputId = useId();

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
      <label htmlFor={inputId} className={disabled ? "file-button disabled" : "file-button"}>
        {file ? file.name : "Choose video"}
      </label>
    </div>
  );
}
